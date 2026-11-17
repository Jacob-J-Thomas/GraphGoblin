import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

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
  const apps = join(home, 'Applications');
  const application = join(apps, name);
  const foreign = join(apps, foreignName);
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
  function install(label, checkout, installName, code, stdout, stderr, extraEnv) {
    checked(
      label,
      installer,
      [
        checkout,
        ordinary,
        node,
        '--',
        '--app-name',
        installName,
        '--data-dir',
        data,
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
  assert.ok(!existsSync(application) && !existsSync(foreign) && !existsSync(data));
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
  assert.ok(!existsSync(application) && !existsSync(data));
  assert.deepEqual(stages(), initialStages);

  const installedText = 'GraphGoblin was installed in Applications.\n';
  install('installer-first', repo, name, 0, installedText, '', { LC_ALL: 'ggcanary17544768eaef' });
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
