import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEntryFixtures } from './macos-launcher-coverage-fixture.acceptance.mjs';
import {
  checkCoverage,
  coverageRows,
  presentationFixture,
  productionInventory,
  verifyCoverageSentinel,
  verifyPresentationCoverage,
  verifyPresentationProfiles,
} from './macos-launcher-coverage.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function witness(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && stat.size > 0, 'Missing nonempty artifact: ' + path);
  const bytes = readFileSync(path);
  assert.equal(bytes.length, stat.size);
  return { path, size: bytes.length, sha256: digest(bytes) };
}

function recorder(out, defaultCwd) {
  const write = (filename, data) =>
    writeFileSync(join(out, filename), data, { flag: 'wx', mode: 0o600 });
  const record = (filename, value) => write(filename, JSON.stringify(value, null, 2) + '\n');
  function run(label, executable, args, options = {}) {
    const {
      cwd = defaultCwd,
      env = process.env,
      timeout = 30_000,
      expectedStatus = 0,
      cleanStderr = false,
    } = options;
    const result = spawnSync(executable, args, {
      cwd,
      env,
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      killSignal: 'SIGKILL',
    });
    const stdout = result.stdout ?? Buffer.alloc(0);
    const stderr = result.stderr ?? Buffer.alloc(0);
    write(label + '.stdout', stdout);
    write(label + '.stderr', stderr);
    record(label + '.json', {
      executable,
      args,
      cwd,
      timeout,
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: { size: stdout.length, sha256: digest(stdout) },
      stderr: { size: stderr.length, sha256: digest(stderr) },
    });
    if (
      result.error ||
      result.signal !== null ||
      (expectedStatus !== null && result.status !== expectedStatus) ||
      (cleanStderr && stderr.length > 0)
    ) {
      console.error(stderr.toString());
      throw new Error(label + ' did not complete with its expected result. See recorded streams.');
    }
    return { status: result.status, stdout, stderr };
  }
  return { run, record, write };
}

function coverageTools(run, scratch) {
  const xcrun = (label, tool, args, options = {}) =>
    run(label, '/usr/bin/xcrun', ['--sdk', 'macosx', tool, ...args], options);
  function merge(label, inputs) {
    for (const input of inputs) witness(input);
    const merged = join(scratch, label + '.profdata');
    xcrun(label, 'llvm-profdata', ['merge', '-sparse', '-o', merged, ...inputs], {
      cleanStderr: true,
    });
    return merged;
  }
  function load(label, profile, objects, directory) {
    const [primary, ...additional] = objects;
    const result = xcrun(
      label,
      'llvm-cov',
      [
        'export',
        '-instr-profile=' + profile,
        primary,
        ...additional.flatMap((object) => ['-object', object]),
      ],
      { cleanStderr: true },
    );
    return coverageRows(JSON.parse(result.stdout), directory);
  }
  return { xcrun, merge, load };
}

function sentinel(scratch, run, record, tools) {
  const directory = join(scratch, 'sentinel');
  mkdirSync(directory, { mode: 0o700 });
  const sources = {
    'Shared.swift': [
      '@inline(never) func coverageSentinel(_ left: Bool) -> Int {',
      '    if left {',
      '        return 11',
      '    }',
      '    return 22',
      '}',
    ],
    'Untouched.swift': [
      '@inline(never) public func coverageSentinelUntouched() -> Int {',
      '    return 33',
      '}',
    ],
    'Left.swift': [
      '@main enum CoverageSentinelLeft {',
      '    static func main() { print(coverageSentinel(true)) }',
      '}',
    ],
    'Right.swift': [
      '@main enum CoverageSentinelRight {',
      '    static func main() { print(coverageSentinel(false)) }',
      '}',
    ],
  };
  for (const [name, lines] of Object.entries(sources)) {
    writeFileSync(join(directory, name), lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  }
  const launch = (side, expected) => {
    const output = join(directory, 'probe-' + side);
    const profile = join(directory, side + '.profraw');
    tools.xcrun('compile-sentinel-' + side, 'swiftc', [
      '-Onone',
      '-target',
      'arm64-apple-macosx15.0',
      '-parse-as-library',
      '-profile-generate',
      '-profile-coverage-mapping',
      '-module-name',
      'GraphGoblinCoverageSentinel',
      join(directory, 'Shared.swift'),
      join(directory, 'Untouched.swift'),
      join(directory, side + '.swift'),
      '-o',
      output,
    ]);
    const result = run('run-sentinel-' + side, output, [], {
      cwd: directory,
      env: { ...process.env, LLVM_PROFILE_FILE: profile },
      cleanStderr: true,
    });
    assert.equal(result.stdout.toString(), expected);
    return { output, profile };
  };
  const left = launch('Left', '11\n');
  const right = launch('Right', '22\n');
  const leftProfile = tools.merge('left-sentinel-profile', [left.profile]);
  const rightProfile = tools.merge('right-sentinel-profile', [right.profile]);
  const combinedProfile = tools.merge('combined-sentinel-profile', [left.profile, right.profile]);
  const objects = [left.output, right.output];
  const reports = {
    left: tools.load('left-sentinel-coverage', leftProfile, [left.output], directory),
    right: tools.load('right-sentinel-coverage', rightProfile, [right.output], directory),
    combined: tools.load('combined-sentinel-coverage', combinedProfile, objects, directory),
    rightUnrun: tools.load('unrun-right-sentinel-coverage', leftProfile, objects, directory),
  };
  verifyCoverageSentinel(reports);
  record('sentinel.json', {
    source: Object.keys(sources).map((name) => witness(join(directory, name))),
    objects: objects.map(witness),
    profiles: [leftProfile, rightProfile, combinedProfile].map(witness),
    reports: Object.fromEntries(
      Object.entries(reports).map(([key, rows]) => [key, Object.fromEntries(rows)]),
    ),
  });
  return leftProfile;
}

function main() {
  if (
    process.platform !== 'darwin' ||
    process.arch !== 'arm64' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  ) {
    throw new Error(
      'The instrumented native fixture runs on a disposable hosted arm64 macOS runner.',
    );
  }
  assert.equal(process.argv.length, 3, 'Supply a fresh coverage artifact directory.');
  const repo = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
  const pkg = join(repo, 'apps/macos-launcher');
  const out = resolve(process.argv[2]);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out, { mode: 0o700 });
  assert.ok(process.env.RUNNER_TEMP, 'Expected the hosted runner scratch directory.');
  const scratch = mkdtempSync(join(realpathSync(process.env.RUNNER_TEMP), 'graphgoblin-coverage-'));
  const { run, record } = recorder(out, scratch);
  const tools = coverageTools(run, scratch);
  const node = realpathSync(process.execPath);
  tools.xcrun('swift-version', 'swift', ['--version']);
  tools.xcrun('llvm-cov-version', 'llvm-cov', ['--version']);
  tools.xcrun('llvm-profdata-version', 'llvm-profdata', ['--version']);
  const zeroProfile = sentinel(scratch, run, record, tools);

  const describe = tools.xcrun('package-description', 'swift', [
    'package',
    '--package-path',
    pkg,
    '--scratch-path',
    join(scratch, 'description'),
    'describe',
    '--type',
    'json',
  ]);
  const tracked = run('tracked-swift-files', 'git', ['ls-files', '-z', '--', '*.swift'], {
    cwd: pkg,
  });
  const packageFiles = tracked.stdout
    .toString()
    .split('\0')
    .filter((path) => path.endsWith('.swift') && path !== 'Package.swift');
  const sources = productionInventory(JSON.parse(describe.stdout), new Set(packageFiles));
  const childSource = join(pkg, presentationFixture.path, presentationFixture.source);
  const childSourceWitness = witness(childSource);
  record('presentation-fixture-source.json', {
    target: presentationFixture.name,
    ...childSourceWitness,
  });
  const sourceDigests = new Map(
    [...sources.keys()].map((path) => [path, digest(readFileSync(join(pkg, path)))]),
  );
  record(
    'production-sources.json',
    [...sources].map(([path, target]) => ({ path, target, sha256: sourceDigests.get(path) })),
  );

  const common = ['--package-path', pkg, '--arch', 'arm64'];
  const ordinaryArgs = [
    'build',
    ...common,
    '--scratch-path',
    join(scratch, 'release'),
    '--configuration',
    'release',
  ];
  tools.xcrun('ordinary-launcher-build', 'swift', [...ordinaryArgs, '--product', 'GraphGoblin'], {
    timeout: 150_000,
  });
  const ordinaryDir = tools
    .xcrun('ordinary-bin-path', 'swift', [...ordinaryArgs, '--show-bin-path'])
    .stdout.toString()
    .trim();
  const ordinary = realpathSync(join(ordinaryDir, 'GraphGoblin'));
  const ordinaryWitness = witness(ordinary);
  const testScratch = join(scratch, 'swift-test');
  const swiftFixtureRoot = join(scratch, 'swift-fixtures');
  mkdirSync(swiftFixtureRoot, { mode: 0o700 });
  const presentationProfileDir = join(scratch, 'presentation-profiles');
  mkdirSync(presentationProfileDir, { mode: 0o700 });
  const swiftEnv = {
    ...process.env,
    GG_MACOS_COVERAGE_FIXTURE_ROOT: swiftFixtureRoot,
    GG_MACOS_COVERAGE_REPO: repo,
    GG_MACOS_COVERAGE_NODE: node,
    GG_MACOS_COVERAGE_LAUNCHER: ordinary,
    GG_MACOS_COVERAGE_PRESENTATION_PROFILES: presentationProfileDir,
  };
  const tests = tools.xcrun(
    'swift-tests',
    'swift',
    ['test', ...common, '--scratch-path', testScratch, '--enable-code-coverage', '--verbose'],
    { timeout: 270_000, env: swiftEnv },
  );
  console.log(tests.stdout.toString());
  const debug = realpathSync(join(testScratch, 'debug'));
  const testName = 'GraphGoblinMacLauncherPackageTests';
  const launcher = join(debug, 'GraphGoblin');
  const installer = join(debug, 'GraphGoblinLauncherInstaller');
  const child = join(debug, presentationFixture.name);
  const objects = [
    join(debug, testName + '.xctest', 'Contents', 'MacOS', testName),
    launcher,
    installer,
    child,
  ];
  const objectWitnesses = objects.map(witness);
  assert.notEqual(witness(launcher).sha256, ordinaryWitness.sha256);
  const testProfile = join(debug, 'codecov', 'default.profdata');
  const childProfileNames = readdirSync(presentationProfileDir).sort();
  verifyPresentationProfiles(childProfileNames);
  const childProfiles = childProfileNames.map((name) => {
    const path = join(presentationProfileDir, name);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && stat.nlink === 1 && stat.size > 0, 'Invalid raw profile: ' + path);
    return path;
  });
  const childIndexed = tools.merge('presentation-fixture-profile', childProfiles);
  const childCoverage = tools.load('presentation-fixture-coverage', childIndexed, [child], pkg);
  verifyPresentationCoverage(childCoverage);
  const profiles = [testProfile, ...childProfiles];
  const { profiles: entryProfiles, outcomes } = runEntryFixtures({
    repo,
    scratch,
    launcher,
    installer,
    ordinary,
    node,
    run,
  });
  profiles.push(...entryProfiles);
  assert.deepEqual(objects.map(witness), objectWitnesses);
  assert.deepEqual(witness(ordinary), ordinaryWitness);
  assert.deepEqual(witness(childSource), childSourceWitness);
  for (const [path, sha256] of sourceDigests) {
    assert.equal(
      digest(readFileSync(join(pkg, path))),
      sha256,
      'Source changed during coverage: ' + path,
    );
  }
  record('profile-inputs.json', {
    objects: objectWitnesses,
    ordinary: ordinaryWitness,
    profiles: profiles.map(witness),
    presentationFixture: {
      object: witness(child),
      profiles: childProfiles.map(witness),
      indexed: witness(childIndexed),
      productionEntry: childCoverage.get('Presentation/LauncherPresentationEntry.swift'),
    },
    outcomes,
  });
  const indexed = tools.merge('swift-coverage-profile', profiles);
  copyFileSync(indexed, join(out, 'swift-coverage.profdata'));
  // The sentinel profile uses its own named module. No product function should have a matching counter.
  const baseline = tools.load('swift-zero-baseline', zeroProfile, objects, pkg);
  const observed = tools.load('swift-coverage', indexed, objects, pkg);
  const report = checkCoverage({ sources, sourceDigests, baseline, observed });
  record('coverage-summary.json', report);
  for (const metric of ['lines', 'regions']) {
    const { count, covered } = report.totals[metric];
    console.log(
      'Swift ' +
        metric +
        ': ' +
        covered +
        '/' +
        count +
        ' (' +
        ((100 * covered) / count).toFixed(2) +
        '%)',
    );
  }
  if (!report.meetsThreshold) process.exitCode = 1;
}

main();
