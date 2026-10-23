// Adapts only test-fixture bind ports and temporary-directory names; test bodies remain unchanged.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const web = path.join(root, 'apps/web');
const req = createRequire(path.join(web, 'package.json'));
module.exports = async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-qa-129-r2-e2e-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));
  const url = (p) => pathToFileURL(p).href;
  const map = {
    '@graphgoblin/api': url(path.join(root, 'apps/api/dist/index.js')),
    '@graphgoblin/api/testing': url(path.join(tmp, 'test-app.ts')),
    '@graphgoblin/engine/testing': url(path.join(root, 'packages/engine/dist/testing/index.js')),
    '@graphgoblin/contracts': url(path.join(root, 'packages/contracts/dist/index.js')),
    zod: url(req.resolve('zod')),
  };
  function remap(s, source) {
    return s.replace(/from (['"])([^'"]+)\1/g, (all, q, name) => {
      if (map[name]) return 'from ' + JSON.stringify(map[name]);
      if (name.startsWith('.')) {
        let p = path.resolve(path.dirname(source), name);
        if (p.endsWith('.js')) p = p.slice(0, -3) + '.ts';
        if (p.endsWith('fake-classifier.ts')) p = path.join(tmp, 'fake-classifier.ts');
        return 'from ' + JSON.stringify(url(p));
      }
      return all;
    });
  }
  const fakePath = path.join(root, 'apps/api/src/testing/fake-classifier.ts');
  let fake = fs
    .readFileSync(fakePath, 'utf8')
    .replace("server.listen(0, '127.0.0.1', resolve)", "server.listen(5649, '127.0.0.1', resolve)");
  fs.writeFileSync(path.join(tmp, 'fake-classifier.ts'), fake);
  const testPath = path.join(root, 'apps/api/src/testing/test-app.ts');
  let test = fs.readFileSync(testPath, 'utf8').replace("'gg-api-'", "'gg-qa-129-r2-e2e-store-'");
  test = remap(test, testPath)
    .replaceAll('/apps/api/src/app.ts', '/apps/api/dist/app.js')
    .replaceAll('/apps/api/src/config.ts', '/apps/api/dist/config.js')
    .replaceAll('/apps/api/src/container.ts', '/apps/api/dist/container.js');
  fs.writeFileSync(path.join(tmp, 'test-app.ts'), test);
  const serverPath = path.join(web, 'e2e/server.ts');
  let server = remap(fs.readFileSync(serverPath, 'utf8'), serverPath);
  server = server.replace(
    "const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');",
    'let qaNextPort = 5642;\nconst dist = ' + JSON.stringify(path.join(web, 'dist')) + ';',
  );
  server = server
    .replace('port: 0 });', 'port: qaNextPort++ });')
    .replace(
      "controlServer.listen(0, '127.0.0.1', done)",
      "controlServer.listen(5640, '127.0.0.1', done)",
    )
    .replace("'gg-e2e-live-'", "'gg-qa-129-r2-e2e-live-'");
  fs.writeFileSync(path.join(tmp, 'server.ts'), server);
  const child = spawn(
    process.execPath,
    ['--import', url(req.resolve('tsx')), path.join(tmp, 'server.ts')],
    {
      cwd: web,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, JEV_API_KEY: '', GG_JEV_API_KEY: '' },
    },
  );
  let buffer = '';
  let errors = '';
  child.stderr.on('data', (x) => (errors += x));
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(Error('QA regression fixture startup timeout: ' + errors)),
        60000,
      );
      child.stdout.on('data', (x) => {
        buffer += x;
        const base = /GG_E2E_READY (\S+)/.exec(buffer);
        const control = /GG_E2E_CONTROL (\S+)/.exec(buffer);
        if (base && control) {
          process.env.GG_E2E_BASE_URL = base[1];
          process.env.GG_E2E_CONTROL_URL = control[1];
          resolve();
        }
      });
      child.once('exit', (code) => reject(Error('QA fixture exited ' + code + ': ' + errors)));
    });
  } finally {
    clearTimeout(timer);
  }
  fs.writeFileSync(
    path.join(__dirname, 'r2-regression-environment.json'),
    JSON.stringify(
      {
        base: process.env.GG_E2E_BASE_URL,
        control: process.env.GG_E2E_CONTROL_URL,
        apiPorts: '5642 through 5648',
        classifierPort: 5649,
        temp: '%TEMP%/' + path.basename(tmp),
        testBodies: 'Unmodified repository specs',
        fixtureChanges:
          'Only bind ports, temp prefix and import locations; built API and built web.',
      },
      null,
      2,
    ),
  );
  return async () => {
    const done = once(child, 'exit');
    child.stdin.end('stop\n');
    await Promise.race([done, new Promise((r) => setTimeout(r, 10000))]);
    if (child.exitCode === null) child.kill();
    const absolute = path.resolve(tmp);
    if (
      path.dirname(absolute) !== path.resolve(os.tmpdir()) ||
      !path.basename(absolute).startsWith('gg-qa-129-')
    )
      throw Error('Unsafe cleanup target');
    fs.rmSync(absolute, { recursive: true, force: true });
  };
};
