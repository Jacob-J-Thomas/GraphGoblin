import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { request } from 'node:http';
import { basename, dirname, join } from 'node:path';

const expected = {"root":"/Users/jake/Library/Caches/graphgoblin-456-owner-acceptance-b5423e10d95f472a91a67e784d6d954d/tmp/graphgoblin-macos-acceptance-RSaOBo","app":"/Users/jake/Applications/GraphGoblin QA 7a86089454aa49539113187409ee0e31.app","dataDir":"/Users/jake/Library/Caches/graphgoblin-456-owner-acceptance-b5423e10d95f472a91a67e784d6d954d/tmp/graphgoblin-macos-acceptance-RSaOBo/store \u03b1 %","ports":{"primary":62277,"contender":62278},"fingerprint":"d0cd64d290add3b5023587801012f4cc18d293e96c9cd3e7618209701a178831","owner":{"pid":44374,"birth":"Mon Nov 16 14:50:03 2026","command":"/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node /Users/jake/Library/Caches/graphgoblin-456-product-build-db37bfdf935746039f9030c4d49b10fb/repo/apps/api/dist/main.js","leases":[{"name":"graphgoblin.lock","hash":"eb4ca7fed41aa74f3d2993af53e1af84f297b5793a65283749aa8067c8f3e844","identity":{"device":"16777232","inode":"178889773"}},{"name":"graphgoblin.db.graphgoblin.lock","hash":"06ee204c335915e763be9e255458e1796d66c517b54f2f4df50631e45180c2e8","identity":{"device":"16777232","inode":"178889776"}}]},"replacement":{"id":"d70cfbc9baed42ccaf9f2b25c11f2d26","witness":{"bundle":{"device":"16777232","inode":"178890807"},"executable":"61f79e2af69222de3db83ca1fddd4d90298fffedc90a44354adba185f1b91ca5","plist":"df61e76416c0330bcdfcdf76be55605e78e5dec6da0237b11d688c5c624f8799","configuration":"abb440c932673b12116a4a0a0e572cf96eb0c23af8a367b639c6653b2988da69"},"receiptPath":"/Users/jake/Library/Application Support/GraphGoblin/LauncherInstalls/d70cfbc9baed42ccaf9f2b25c11f2d26.json","receiptIdentity":{"device":"16777232","inode":"178890816"},"receiptHash":"26c37d76f1d7dd33f3f828a45fa70a57ff8a4db7f8b6a61a3c4a69cb8ebbe9b6"},"token":"b5423e10d95f472a91a67e784d6d954d","stage":"/Users/jake/Library/Caches/graphgoblin-456-owner-acceptance-b5423e10d95f472a91a67e784d6d954d","repo":"/Users/jake/Library/Caches/graphgoblin-456-product-build-db37bfdf935746039f9030c4d49b10fb/repo","snapshot":{"gateway.log":{"bytes":9223,"sha256":"d1063bff1eb0d06f9f6cc1b3842d253df551fed8f760a2f694d1f56f6564cd9a"},"launcher.log":{"bytes":127,"sha256":"fcf519de93979443a0e3efd7627aedb717b0b61b59113b1ad23acf8a6f280fdf"}}};
const nodePath = '/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node';
const nodeDigest = 'e67e9c664f5b3d6d9fc0050ac895d8f30d213ce340c84439750edc9cc449d010';
const uid = 501n;
const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/Users/jake', LANG: 'C', LC_ALL: 'C' };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const require = (condition, detail) => { if (!condition) throw Error(detail); };
const absent = (error) => error.code === 'ENOENT';
const ident = (stat) => ({
  device: BigInt.asUintN(64, stat.dev).toString(),
  inode: BigInt.asUintN(64, stat.ino).toString(),
});
const assertIdentity = (actual, known, label) => {
  require(actual.device === known.device && actual.inode === known.inode, label + ' identity mismatch');
};
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.nlink === b.nlink
  && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

function file(path, maximum, rules = {}) {
  const info = lstatSync(path, { bigint: true });
  require(info.isFile() && info.uid === uid && info.nlink === 1n && info.size <= BigInt(maximum)
    && realpathSync(path) === path, 'Unbound or oversized regular file: ' + path);
  if (rules.private) require((info.mode & 0o077n) === 0n, 'Nonprivate file: ' + path);
  const identity = ident(info);
  if (rules.identity) assertIdentity(identity, rules.identity, path);
  if (rules.device) require(identity.device === rules.device, 'Wrong volume: ' + path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    require(same(info, fstatSync(fd, { bigint: true })), 'File changed before open: ' + path);
    const bytes = Buffer.alloc(Number(info.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      require(count > 0, 'Short read: ' + path);
      offset += count;
    }
    require(readSync(fd, Buffer.alloc(1), 0, 1, offset) === 0
      && same(info, fstatSync(fd, { bigint: true })) && same(info, lstatSync(path, { bigint: true })),
    'File changed while reading: ' + path);
    const sha256 = hash(bytes);
    if (rules.sha256) require(sha256 === rules.sha256, 'File digest mismatch: ' + path);
    return { bytes, sha256, identity, mode: (info.mode & 0o7777n).toString(8) };
  } finally { closeSync(fd); }
}

function directory(path, privateMode) {
  const info = lstatSync(path, { bigint: true });
  require(info.isDirectory() && info.uid === uid && realpathSync(path) === path
    && (!privateMode || (info.mode & 0o077n) === 0n), 'Directory is outside the bound fixture: ' + path);
  return ident(info);
}

function native(path, args) {
  return new Promise((done) => {
    execFile(path, args, { env, timeout: 3000, maxBuffer: 8192, encoding: 'utf8' },
      (error, stdout, stderr) => done({
        code: error ? error.code : 0, signal: error?.signal ?? null, stdout, stderr,
      }));
  });
}

function health(port) {
  return new Promise((done) => {
    const call = request({ host: '127.0.0.1', port, path: '/healthz', method: 'GET', agent: false,
      signal: AbortSignal.timeout(1500) });
    call.once('error', (e) => done({ error: e.code ?? e.name }));
    call.once('response', (res) => {
      const chunks = [];
      let size = 0;
      res.once('error', (e) => done({ error: e.code ?? e.name }));
      res.on('data', (part) => {
        size += part.length;
        if (size > 4096) res.destroy(Object.assign(Error('health cap'), { code: 'EVIDENCE_CAP' }));
        else chunks.push(part);
      });
      res.once('end', () => {
        const identity = res.headers['x-graphgoblin-instance'] ?? null;
        const pid = res.headers['x-graphgoblin-pid'] ?? null;
        done({ status: res.statusCode, identity, pid, phase: res.headers['x-graphgoblin-phase'] ?? null,
          expected: identity === expected.fingerprint && pid === String(expected.owner.pid),
          exactHealthBody: Buffer.concat(chunks).equals(Buffer.from('{"status":"ok"}')) });
      });
    });
    call.end();
  });
}

async function processAndPorts() {
  const { primary, contender } = expected.ports;
  const [ps, healthPrimary, healthContender, listeningPrimary, listeningContender] = await Promise.all([
    native('/bin/ps', ['-ww', '-p', String(expected.owner.pid), '-o', 'uid=', '-o', 'lstart=', '-o', 'command=']),
    health(primary), health(contender),
    native('/usr/sbin/lsof', ['-nP', '-a', '-iTCP:' + primary, '-sTCP:LISTEN']),
    native('/usr/sbin/lsof', ['-nP', '-a', '-iTCP:' + contender, '-sTCP:LISTEN']),
  ]);
  const expectedLine = String(uid) + ' ' + expected.owner.birth + ' ' + expected.owner.command;
  return {
    pid: { ...ps, matchesOriginal: ps.code === 0 && ps.stdout.trim().replace(/\s+/gu, ' ') === expectedLine.replace(/\s+/gu, ' '),
      absent: ps.code === 1 && ps.signal === null && !ps.stdout && !ps.stderr },
    ports: [{ port: primary, health: healthPrimary, lsof: listeningPrimary },
      { port: contender, health: healthContender, lsof: listeningContender }],
  };
}

function leases() {
  const paths = [expected.stage, join(expected.stage, 'tmp'), expected.root, expected.dataDir];
  const parents = paths.map((path) => ({ path, ...directory(path, true) }));
  const records = [];
  for (const lease of expected.owner.leases) {
    for (const name of [lease.name, lease.name + '.reclaim']) {
      try {
        const info = lstatSync(join(expected.dataDir, name), { bigint: true });
        const identity = ident(info);
        records.push({ name, present: true, identity, uid: Number(info.uid), kind: info.isFile() ? 'regular'
          : info.isDirectory() ? 'directory' : info.isSymbolicLink() ? 'symlink' : 'other',
          matchesOriginal: name === lease.name && JSON.stringify(identity) === JSON.stringify(lease.identity) });
      } catch (error) {
        if (!absent(error)) throw error;
        records.push({ name, present: false });
      }
    }
  }
  return { parents, records };
}

function installation() {
  const replacement = expected.replacement;
  const bundle = directory(expected.app, false);
  assertIdentity(bundle, replacement.witness.bundle, 'replacement app');
  const applications = directory(dirname(expected.app), false);
  const contents = join(expected.app, 'Contents');
  directory(contents, false);
  directory(join(contents, 'MacOS'), false);
  directory(join(contents, 'Resources'), false);
  const receipt = file(replacement.receiptPath, 16_384, {
    private: true, identity: replacement.receiptIdentity, sha256: replacement.receiptHash,
  });
  const record = JSON.parse(receipt.bytes.toString('utf8'));
  require(record.version === 1 && record.id === replacement.id && record.name === basename(expected.app)
    && record.staged === undefined && record.stageName === undefined, 'Replacement receipt contents mismatch');
  assertIdentity(record.applications, applications, 'Applications parent');
  assertIdentity(record.installed.bundle, bundle, 'receipt bundle');
  const artifacts = {};
  for (const [key, relative, cap] of [
    ['executable', 'MacOS/GraphGoblin', 8 * 1024 * 1024],
    ['plist', 'Info.plist', 32_768],
    ['configuration', 'Resources/launcher.json', 16_384],
  ]) {
    const known = replacement.witness[key];
    require(record.installed[key] === known, 'Replacement receipt hash mismatch: ' + key);
    const data = file(join(contents, relative), cap, { sha256: known });
    artifacts[key] = { sha256: data.sha256, identity: data.identity, bytes: data.bytes.length };
    if (key === 'configuration') {
      const cfg = JSON.parse(data.bytes.toString('utf8'));
      require(cfg.port === expected.ports.contender && cfg.dataDirectory === expected.dataDir
        && cfg.checkout === expected.repo, 'Replacement config escaped bound fixture');
    }
  }
  return { id: replacement.id, bundle, applications, receipt: { identity: receipt.identity, sha256: receipt.sha256 }, artifacts };
}

function logs() {
  const root = '/Users/jake/Library/Logs/GraphGoblin/LauncherInstances/' + expected.replacement.id;
  const rootIdentity = directory(root, true);
  require(rootIdentity.device === expected.replacement.witness.bundle.device, 'Log volume differs from fixture');
  const files = {};
  const shutdown = [];
  for (const [name, cap] of [
    ['gateway.log', 4 * 1024 * 1024], ['gateway.log.1', 4 * 1024 * 1024],
    ['launcher.log', 262_144], ['launcher.log.1', 262_144],
  ]) {
    try {
      const data = file(join(root, name), cap, { private: true, device: rootIdentity.device });
      const historic = expected.snapshot[name];
      const samePrefix = historic && data.bytes.length >= historic.bytes
        ? hash(data.bytes.subarray(0, historic.bytes)) === historic.sha256 : null;
      files[name] = { bytes: data.bytes.length, sha256: data.sha256, identity: data.identity, mode: data.mode,
        matchesCapturedPrefix: samePrefix, rawBase64: data.bytes.toString('base64') };
      if (name.startsWith('gateway')) {
        const lines = data.bytes.toString('utf8').split('\n');
        for (const line of lines.slice(0, -1)) {
          let row;
          try { row = JSON.parse(line); } catch { continue; }
          const access = row.req ?? row.res;
          if (row.pid !== expected.owner.pid || access?.route !== '/system/shutdown') continue;
          if (shutdown.length < 32) shutdown.push({ slot: name, reqId: row.reqId, at: row.time,
            method: access.method, status: access.statusCode ?? null, event: row.msg });
        }
      }
    } catch (error) {
      files[name] = absent(error) ? { absent: true } : { error: error.message };
    }
  }
  assertIdentity(directory(root, true), rootIdentity, 'log root');
  return { root, rootIdentity, shutdown, files };
}

require(process.platform === 'darwin' && process.arch === 'arm64'
  && process.getuid() === Number(uid) && process.geteuid() === Number(uid)
  && process.execPath === nodePath && process.versions.node === '22.22.2', 'Host or runtime mismatch');
const node = lstatSync(nodePath, { bigint: true });
require(node.isFile() && node.uid === uid && node.size === 84_640n && realpathSync(nodePath) === nodePath
  && hash(readFileSync(nodePath)) === nodeDigest, 'Pinned Node bytes or metadata mismatch');
const deadline = setTimeout(() => { process.stderr.write('Drain diagnosis outer deadline\n'); process.exit(2); }, 17_000);
const report = { schema: 'gg456-owner-acceptance-drain-diagnosis/v1', at: new Date().toISOString(),
  token: expected.token, expected: { owner: expected.owner, ports: expected.ports, id: expected.replacement.id } };
report.before = await processAndPorts();
try { report.leases = leases(); } catch (error) { report.leaseError = error.message; }
try { report.installation = installation(); } catch (error) { report.installationError = error.message; }
if (report.installation) {
  try { report.logs = logs(); } catch (error) { report.logError = error.message; }
}
report.after = await processAndPorts();
try { report.leasesAfter = leases(); } catch (error) { report.leaseAfterError = error.message; }
clearTimeout(deadline);
process.stdout.write(JSON.stringify(report) + '\n');
