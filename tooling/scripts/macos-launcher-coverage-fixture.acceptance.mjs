import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const plistFile = 'Contents/Info.plist';
const binaryFile = 'Contents/MacOS/GraphGoblin';
const configFile = 'Contents/Resources/launcher.json';
const installHelp = [
  'Usage: scripts/install-macos-launcher.sh [--app-name BASENAME.app] [--node ABS_PATH]',
  '       [--data-dir ABS_PATH] [--port N] [--require-api-key] [--disable-ollama]',
  '       [--codex-binary ABS_PATH] [--claude-binary ABS_PATH]',
  '       scripts/install-macos-launcher.sh --help',
  '',
].join('\n');

function identity(path, isDirectory) {
  const stat = lstatSync(path, { bigint: true });
  assert.ok(isDirectory ? stat.isDirectory() : stat.isFile());
  assert.equal(stat.uid, BigInt(process.getuid()));
  if (!isDirectory) assert.equal(stat.nlink, 1n);
  assert.equal(stat.mode & 0o022n, 0n);
  return { device: String(stat.dev), inode: String(stat.ino) };
}

const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function readInstalled(application, receiptRoot, name, plist, expectedConfig, ordinary) {
  assert.deepEqual(readdirSync(application), ['Contents']);
  assert.deepEqual(readdirSync(join(application, 'Contents')).sort(), [
    'Info.plist',
    'MacOS',
    'Resources',
  ]);
  assert.deepEqual(readdirSync(join(application, 'Contents/MacOS')), ['GraphGoblin']);
  assert.deepEqual(readdirSync(join(application, 'Contents/Resources')), ['launcher.json']);
  assert.equal(plist.CFBundleExecutable, 'GraphGoblin');
  assert.match(plist.GraphGoblinInstallationID, /^[a-f0-9]{32}$/u);
  const id = plist.GraphGoblinInstallationID;
  assert.equal(plist.CFBundleIdentifier, 'com.graphgoblin.launcher.instance.' + id);
  const receipt = join(receiptRoot, id + '.json');
  for (const relative of [plistFile, binaryFile, configFile])
    identity(join(application, relative), false);
  const receiptIdentity = identity(receipt, false);
  const config = JSON.parse(readFileSync(join(application, configFile), 'utf8'));
  assert.deepEqual(config, expectedConfig);
  const installed = {
    bundle: identity(application, true),
    executable: digest(join(application, binaryFile)),
    plist: digest(join(application, plistFile)),
    configuration: digest(join(application, configFile)),
  };
  assert.equal(installed.executable, digest(ordinary));
  assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), {
    version: 1,
    id,
    name,
    applications: identity(dirname(application), true),
    installed,
  });
  return { id, receipt, receiptIdentity, installed };
}

function expectClosed(result, code, stdout, stderr = '') {
  assert.equal(result.status, code);
  assert.equal(result.stdout.toString(), stdout);
  assert.equal(result.stderr.toString(), stderr);
}

export function runEntryFixtures({ repo, scratch, launcher, installer, ordinary, node, run }) {
  const home = userInfo().homedir;
  assert.equal(home, homedir());
  const id = randomUUID();
  const name = 'GraphGoblin QA ' + id + '.app';
  const foreignName = 'GraphGoblin QA foreign ' + id + '.app';
  const freshName = 'GraphGoblin QA fresh ' + id + '.app';
  const apps = join(home, 'Applications');
  const application = join(apps, name);
  const foreign = join(apps, foreignName);
  const fresh = join(apps, freshName);
  const receiptRoot = join(
    home,
    'Library',
    'Application Support',
    'GraphGoblin',
    'LauncherInstalls',
  );
  const stages = () =>
    existsSync(apps)
      ? readdirSync(apps)
          .filter((n) => n.startsWith('.graphgoblin-launcher-stage-'))
          .sort()
      : [];
  const data = join(scratch, 'installer-fixture-data');
  const badCheckout = join(scratch, 'installer-fixture-missing-asset');
  const env = {
    HOME: home,
    PATH: dirname(node) + ':/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8',
  };
  const profiles = [];
  const outcomes = [];
  function capture(label, binary, args, extraEnv = {}) {
    const profile = join(scratch, label + '.profraw');
    assert.ok(!existsSync(profile));
    const result = run(label, binary, args, {
      cwd: scratch,
      env: { ...env, ...extraEnv, LLVM_PROFILE_FILE: profile },
      expectedStatus: null,
      timeout: 75_000,
    });
    const stat = lstatSync(profile);
    assert.ok(stat.isFile() && stat.size > 0 && stat.nlink === 1);
    profiles.push(profile);
    return result;
  }
  function checked(label, binary, args, code, stdout, stderr = '', extraEnv = {}) {
    expectClosed(capture(label, binary, args, extraEnv), code, stdout, stderr);
    outcomes.push({ label, exit: code, stdout, stderr });
  }
  function install(
    label,
    checkout,
    installName,
    code,
    stdout,
    stderr,
    extraEnv,
    { releasePath = ordinary, nodePath = node, dataPath = data } = {},
  ) {
    checked(
      label,
      installer,
      [
        checkout,
        releasePath,
        nodePath,
        '--',
        '--app-name',
        installName,
        '--data-dir',
        dataPath,
        '--port',
        '56321',
        '--disable-ollama',
      ],
      code,
      stdout,
      stderr,
      extraEnv,
    );
  }
  const initialStages = stages();
  assert.ok(!existsSync(application) && !existsSync(foreign) && !existsSync(fresh));
  assert.ok(!existsSync(data));
  const envelope = (code) => JSON.stringify({ version: 1, code }) + '\n';
  checked('launcher-usage', launcher, ['--invalid-coverage-option'], 64, envelope('usage'));
  for (const [label, flag] of [
    ['launcher-uninstalled-headless', '--ensure-gateway'],
    ['launcher-uninstalled-stage-check', '--validate-installation'],
  ]) {
    checked(label, launcher, [flag], 10, envelope('installation-invalid'));
  }
  const entryArgs = [repo, ordinary, node, '--'];
  checked('installer-help', installer, [...entryArgs, '--help'], 0, installHelp);
  checked(
    'installer-usage',
    installer,
    [...entryArgs, '--port', '56321', '--port', '56321'],
    64,
    '',
    installHelp,
  );
  checked(
    'installer-bootstrap-refusal',
    installer,
    [],
    1,
    '',
    'The candidate bundle could not be staged and verified.\n',
  );
  const keyRefusal =
    'This installer requires the local database and its data-directory master.key, or a fresh store.\n';
  install('installer-master-key-refusal', repo, name, 1, '', keyRefusal, {
    GG_MASTER_KEY: 'isolated-coverage-canary',
  });
  install('installer-remote-db-refusal', repo, name, 1, '', keyRefusal, {
    GG_DB_URL: 'https://example.invalid/database',
  });
  const databaseURL = (path) => pathToFileURL(path).href.replace('file://', 'file://localhost');
  install('installer-wrong-local-db-refusal', repo, name, 1, '', keyRefusal, {
    GG_DB_URL: databaseURL(join(data, 'unrelated.db')),
  });
  assert.ok(!existsSync(application) && !existsSync(data));
  assert.deepEqual(stages(), initialStages);

  const installedText = 'GraphGoblin was installed in Applications.\n';
  install('installer-first', repo, name, 0, installedText, '', {
    LC_ALL: 'ggcanary17544768eaef',
    GG_DB_URL: databaseURL(join(data, 'graphgoblin.db')),
  });
  const expectedConfig = {
    version: 1,
    checkout: repo,
    node,
    dataDirectory: data,
    port: 56321,
    requireAPIKey: false,
    ollamaEnabled: false,
  };
  const inspect = (label) => {
    identity(application, true);
    identity(join(application, plistFile), false);
    const plist = JSON.parse(
      run(label, '/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(application, plistFile)], {
        cwd: scratch,
      }).stdout,
    );
    return readInstalled(application, receiptRoot, name, plist, expectedConfig, ordinary);
  };
  const first = inspect('installer-first-witness');
  install('installer-replace', repo, name, 0, installedText, '');
  const replaced = inspect('installer-replace-witness');
  assert.equal(replaced.id, first.id);
  assert.notDeepEqual(replaced.installed.bundle, first.installed.bundle);

  // The staged launcher reads these real artifact bytes but refuses before its helper runs.
  for (const relative of [
    'apps/api/dist/main.js',
    'apps/api/dist/instance-identity.js',
    'apps/api/dist/macos-log/guard.js',
    'apps/api/dist/managed-log/guard.js',
    'apps/api/dist/managed-log/gateway-log-writer.js',
    'apps/web/dist/index.html',
  ]) {
    const target = join(badCheckout, relative);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repo, relative), target);
  }
  const receiptsBefore = readdirSync(receiptRoot).sort();
  const receiptBefore = readFileSync(replaced.receipt);
  install(
    'installer-staged-assets-refusal',
    badCheckout,
    name,
    1,
    '',
    'Build both apps/web/dist and apps/web/dist-goblin before installing.\n',
  );
  const afterFailure = inspect('installer-rollback-witness');
  assert.deepEqual(afterFailure.installed, replaced.installed);
  assert.deepEqual(readFileSync(replaced.receipt), receiptBefore);
  assert.deepEqual(readdirSync(receiptRoot).sort(), receiptsBefore);

  function expectFreshAbsent() {
    assert.equal(lstatSync(fresh, { throwIfNoEntry: false }), undefined);
    assert.equal(lstatSync(data, { throwIfNoEntry: false }), undefined);
    assert.deepEqual(readdirSync(receiptRoot).sort(), receiptsBefore);
    assert.deepEqual(stages(), initialStages);
  }

  install(
    'installer-fresh-staged-assets-refusal',
    badCheckout,
    freshName,
    1,
    '',
    'Build both apps/web/dist and apps/web/dist-goblin before installing.\n',
  );
  expectFreshAbsent();

  const notExecutable = join(scratch, 'non-executable-installer-input');
  const original = Buffer.from('isolated file must stay unchanged\n');
  writeFileSync(notExecutable, original, { flag: 'wx', mode: 0o600 });
  const fileBefore = identity(notExecutable, false);
  const runtimeRefusal =
    'Choose a native Apple Silicon Node 22.22.2 or later within major 22 with --node.\n';
  install(
    'installer-node-file-refusal',
    repo,
    freshName,
    1,
    '',
    runtimeRefusal,
    {},
    {
      nodePath: notExecutable,
    },
  );
  expectFreshAbsent();
  install(
    'installer-store-file-refusal',
    repo,
    freshName,
    1,
    '',
    'Check the saved checkout and built apps/api/dist entries, then install again.\n',
    {},
    { dataPath: notExecutable },
  );
  expectFreshAbsent();
  assert.deepEqual(identity(notExecutable, false), fileBefore);
  assert.deepEqual(readFileSync(notExecutable), original);

  // Unlike the non-executable input, this executable reaches the staged runtime probe.
  install(
    'installer-fresh-staged-runtime-refusal',
    repo,
    freshName,
    1,
    '',
    runtimeRefusal,
    {},
    {
      nodePath: '/bin/sh',
    },
  );
  expectFreshAbsent();
  const goblinShell = 'apps/web/dist-goblin/index.html';
  mkdirSync(dirname(join(badCheckout, goblinShell)), { recursive: true });
  copyFileSync(join(repo, goblinShell), join(badCheckout, goblinShell));
  writeFileSync(
    join(badCheckout, 'apps/api/dist/instance-identity.js'),
    "process.stdout.write('invalid fingerprint\\n');\n",
  );
  install(
    'installer-fresh-staged-helper-refusal',
    badCheckout,
    freshName,
    1,
    '',
    'The built API identity helper could not be verified. Rebuild the checkout and check the local runtime.\n',
  );
  expectFreshAbsent();

  const missing = join(scratch, 'absent-release-input');
  const alias = join(scratch, 'untrusted-release-alias');
  const short = join(scratch, 'short-release-input');
  const wrongMachO = join(scratch, 'wrong-release-file-type');
  const changedHeader = Buffer.alloc(32);
  changedHeader.set([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 0x01]);
  changedHeader[12] = 0x06; // MH_DYLIB, not the required MH_EXECUTE.
  symlinkSync(ordinary, alias);
  const aliasBefore = lstatSync(alias, { bigint: true });
  writeFileSync(short, 'too short', { flag: 'wx', mode: 0o700 });
  writeFileSync(wrongMachO, changedHeader, { flag: 'wx', mode: 0o700 });
  const ordinaryDigest = digest(ordinary);
  const shortBefore = identity(short, false);
  const wrongMachOBefore = identity(wrongMachO, false);
  for (const [label, releasePath] of [
    ['missing', missing],
    ['alias', alias],
    ['short', short],
    ['wrong-macho-type', wrongMachO],
  ]) {
    install(
      'installer-release-' + label + '-refusal',
      repo,
      freshName,
      1,
      '',
      'The candidate bundle could not be staged and verified.\n',
      {},
      { releasePath },
    );
    // Assembly failures leave the freshly created stage empty. Preserve anything else.
    const additions = stages().filter((entry) => !initialStages.includes(entry));
    assert.equal(additions.length, 1);
    assert.match(additions[0], /^\.graphgoblin-launcher-stage-[a-f0-9]{32}$/u);
    const stage = join(apps, additions[0]);
    const witness = identity(stage, true);
    assert.equal(lstatSync(stage).mode & 0o077, 0);
    assert.deepEqual(readdirSync(stage), []);
    assert.deepEqual(identity(stage, true), witness);
    rmdirSync(stage);
    expectFreshAbsent();
  }
  assert.equal(lstatSync(missing, { throwIfNoEntry: false }), undefined);
  const aliasAfter = lstatSync(alias, { bigint: true });
  assert.ok(aliasAfter.isSymbolicLink());
  assert.equal(aliasAfter.dev, aliasBefore.dev);
  assert.equal(aliasAfter.ino, aliasBefore.ino);
  assert.equal(readlinkSync(alias), ordinary);
  assert.equal(digest(ordinary), ordinaryDigest);
  assert.deepEqual(identity(short, false), shortBefore);
  assert.equal(readFileSync(short, 'utf8'), 'too short');
  assert.deepEqual(identity(wrongMachO, false), wrongMachOBefore);
  assert.deepEqual(readFileSync(wrongMachO), changedHeader);

  const foreignBytes = 'isolated foreign destination\n';
  writeFileSync(foreign, foreignBytes, { flag: 'wx', mode: 0o600 });
  const foreignBefore = identity(foreign, false);
  install(
    'installer-foreign-target-refusal',
    repo,
    foreignName,
    1,
    '',
    'The Applications destination could not be authorized for this installation.\n',
  );
  assert.deepEqual(identity(foreign, false), foreignBefore);
  assert.equal(readFileSync(foreign, 'utf8'), foreignBytes);
  assert.deepEqual(readdirSync(receiptRoot).sort(), receiptsBefore);
  assert.deepEqual(inspect('installer-final-witness'), afterFailure);
  assert.deepEqual(stages(), initialStages);
  assert.ok(!existsSync(data), 'Staged installer validation created fixture store');

  // The suite retains uncertain fixtures on a failure. Successful cleanup is exact and nonrecursive.
  for (const relative of [plistFile, binaryFile, configFile])
    unlinkSync(join(application, relative));
  for (const relative of ['Contents/MacOS', 'Contents/Resources', 'Contents', '.'])
    rmdirSync(join(application, relative));
  assert.deepEqual(identity(afterFailure.receipt, false), afterFailure.receiptIdentity);
  unlinkSync(afterFailure.receipt);
  assert.deepEqual(identity(foreign, false), foreignBefore);
  unlinkSync(foreign);
  return { profiles, outcomes };
}
