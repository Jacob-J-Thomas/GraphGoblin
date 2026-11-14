// Public native launcher CLI, disposable helpers/listeners, no installed app or owner store.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const identity = 'a'.repeat(64);
const native = process.platform === 'win32';
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.toUpperCase().startsWith('GG_') && !['NODE_OPTIONS', 'NODE_DEBUG'].includes(key),
  ),
);
let base;
let exe;
let pipeHolder;

before(async () => {
  if (!native) return;
  base = await mkdtemp(join(tmpdir(), 'gg-launcher-helper-'));
  exe = join(base, 'GraphGoblin.exe');
  await execute(
    join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:winexe',
      '/platform:x64',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Web.Extensions.dll',
      `/out:${exe}`,
      join(root, 'apps/windows-launcher/Launcher.cs'),
    ],
    { windowsHide: true },
  );
  pipeHolder = join(base, 'PipeHolder.exe');
  await execute(
    join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      `/out:${pipeHolder}`,
      join(root, 'tooling/scripts/__fixtures__/launcher-pipe-holder.cs'),
    ],
    { windowsHide: true },
  );
});

after(async () => {
  // Only the fresh directory returned by mkdtemp belongs to this suite.
  if (base) await rm(base, { recursive: true, force: true, maxRetries: 10 });
});

async function fixture(
  program,
  timeout = 3,
  listening = true,
  overrides = {},
  startGateway = false,
) {
  const repo = await mkdtemp(join(base, 'fixture space-α-'));
  await mkdir(join(repo, 'apps/api/dist'), { recursive: true });
  await mkdir(join(repo, 'apps/web/dist'), { recursive: true });
  await writeFile(join(repo, 'package.json'), '{"type":"module"}');
  await writeFile(join(repo, 'apps/web/dist/index.html'), 'fixture');
  const marker = join(repo, 'gateway-was-started');
  await writeFile(
    join(repo, 'apps/api/dist/main.js'),
    startGateway
      ? `import {createServer} from 'node:http'; import {writeFileSync} from 'node:fs';
        writeFileSync(${JSON.stringify(marker)}, 'expected');
        const server = createServer((req,res) => {
          res.setHeader('X-GraphGoblin-Instance', '${identity}');
          res.setHeader('X-GraphGoblin-Pid', String(process.pid));
          res.setHeader('X-GraphGoblin-Phase', 'running'); res.end('fixture');
          if(req.url === '/stop') server.close();
        });
        const timer = setTimeout(() => server.close(), 10000);
        server.on('close', () => clearTimeout(timer)); server.listen(Number(process.env.GG_PORT), '127.0.0.1');`
      : `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unexpected');`,
  );
  await writeFile(join(repo, 'apps/api/dist/instance-identity.js'), program);
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.setHeader('X-GraphGoblin-Instance', identity);
      res.setHeader('X-GraphGoblin-Pid', String(process.pid));
      res.setHeader('X-GraphGoblin-Phase', 'running');
    }
    res.end('fixture');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  if (!listening) await new Promise((resolve) => server.close(resolve));
  const path = join(repo, 'config.json');
  await writeFile(
    path,
    JSON.stringify({
      Repo: repo,
      Node: process.execPath,
      DataDir: join(repo, 'unused-store'),
      Port: port,
      Environment: {},
      StartupTimeoutSeconds: timeout,
      WindowTimeoutSeconds: 1,
      ...overrides,
    }),
  );
  return {
    repo,
    async run() {
      const start = performance.now();
      let result;
      try {
        result = {
          ...(await execute(exe, ['--config', path, '--ensure-gateway'], {
            env,
            windowsHide: true,
            timeout: 35_000,
          })),
          code: 0,
        };
      } catch (error) {
        result = error;
      }
      const elapsed = performance.now() - start;
      assert.notEqual(result.killed, true, 'launcher must finish before the test watchdog');
      if (startGateway) assert.equal(await readFile(marker, 'utf8'), 'expected');
      else await assert.rejects(readFile(marker), { code: 'ENOENT' });
      return { ...result, elapsed };
    },
    async close() {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      if (startGateway) {
        try {
          await fetch(`http://127.0.0.1:${port}/stop`, { signal: AbortSignal.timeout(2000) });
        } catch {
          /* A refused or already stopped fixture has no gateway to close. */
        }
      }
    },
  };
}

test(
  'drains a full stderr pipe while the identity helper is running',
  { skip: !native },
  async () => {
    const f = await fixture(`import {writeSync} from 'node:fs';
    writeSync(2, 'PRIVATE_HELPER_DIAGNOSTIC'.repeat(20000));
    process.stdout.write('${identity}');`);
    try {
      const result = await f.run();
      assert.equal(result.code, 0, result.stderr);
      assert.ok(result.elapsed < 8000);
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_HELPER_DIAGNOSTIC/);
    } finally {
      await f.close();
    }
  },
);

test(
  'allows a slow identity helper within the configured startup budget',
  { skip: !native },
  async () => {
    const f = await fixture(`setTimeout(() => process.stdout.write('${identity}'), 16000);`, 25);
    try {
      const result = await f.run();
      assert.equal(result.code, 0, result.stderr);
      assert.ok(result.elapsed >= 16000 && result.elapsed < 25000);
      assert.match(
        await readFile(join(f.repo, 'launcher.log'), 'utf8'),
        /Slow launcher identity check completed/,
      );
    } finally {
      await f.close();
    }
  },
);

test('bounds a hung identity helper and identifies its stage', { skip: !native }, async () => {
  const f = await fixture(`process.stdout.write('${identity}'); setInterval(() => {}, 1000);`, 1);
  try {
    const result = await f.run();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /identity.*timed out/i);
    assert.ok(result.elapsed >= 15000 && result.elapsed < 19000, `elapsed ${result.elapsed}`);
  } finally {
    await f.close();
  }
});

test(
  'rejects oversized stdout without pipe deadlock or logging its content',
  { skip: !native },
  async () => {
    const f = await fixture(`import {writeSync} from 'node:fs';
    writeSync(1, '${identity}' + 'PRIVATE_HELPER_OUTPUT'.repeat(20000));`);
    try {
      const result = await f.run();
      assert.equal(result.code, 1);
      assert.match(result.stderr, /identity.*output/i);
      assert.ok(result.elapsed < 8000);
      assert.doesNotMatch(result.stderr, /PRIVATE_HELPER_OUTPUT/);
    } finally {
      await f.close();
    }
  },
);

test('reports helper exit status without disclosing stderr', { skip: !native }, async () => {
  const f = await fixture(
    "process.stderr.write('PRIVATE_HELPER_DIAGNOSTIC'); process.exitCode = 7;",
  );
  try {
    const result = await f.run();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /identity.*exit.*7/i);
    assert.doesNotMatch(result.stderr, /PRIVATE_HELPER_DIAGNOSTIC/);
  } finally {
    await f.close();
  }
});

test(
  'distinguishes ownership timeout after a successful identity check',
  { skip: !native },
  async () => {
    const f = await fixture(
      `if (process.argv[2] === '--store-state') { process.stdout.write('{"state":"free"}'); setInterval(() => {}, 1000); }
    else process.stdout.write('${identity}');`,
      1,
      false,
    );
    try {
      const result = await f.run();
      assert.equal(result.code, 1);
      assert.match(result.stderr, /ownership.*timed out/i);
      assert.ok(result.elapsed >= 15000 && result.elapsed < 22000, `elapsed ${result.elapsed}`);
    } finally {
      await f.close();
    }
  },
);

test('bounds inherited output handles after the helper exits', { skip: !native }, async () => {
  const marker = join(base, 'inherited-pipe.txt');
  const f = await fixture('', 1, true, {
    Node: pipeHolder,
    Environment: { GG_QA_PIPE_MARKER: marker, GG_QA_PIPE_HOLD_MS: '20000' },
  });
  try {
    const result = await f.run();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /identity.*timed out/i);
    assert.match(result.stderr, /output closure/);
    assert.ok(result.elapsed >= 15000 && result.elapsed < 19000, `elapsed ${result.elapsed}`);
    assert.equal(await readFile(marker, 'utf8'), 'opened\n');
  } finally {
    const deadline = Date.now() + 22000;
    while (Date.now() < deadline) {
      if ((await readFile(marker, 'utf8').catch(() => '')).includes('closed\n')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(await readFile(marker, 'utf8'), 'opened\nclosed\n');
    await f.close();
  }
});

test(
  'allows slow ownership success before starting the matching gateway',
  { skip: !native },
  async () => {
    const f = await fixture(
      `if (process.argv[2] === '--store-state') setTimeout(() => process.stdout.write('{"state":"free"}'), 16000);
    else process.stdout.write('${identity}');`,
      25,
      false,
      {},
      true,
    );
    try {
      const result = await f.run();
      assert.equal(result.code, 0, result.stderr);
      assert.ok(result.elapsed >= 16000 && result.elapsed < 25000);
      assert.match(
        await readFile(join(f.repo, 'launcher.log'), 'utf8'),
        /Slow launcher ownership check completed/,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'preserves held ownership with flooded stderr and does not start a gateway',
  { skip: !native },
  async () => {
    const f = await fixture(
      `import {writeSync} from 'node:fs';
    if(process.argv[2] === '--store-state') {
      writeSync(2, 'PRIVATE_HELPER_DIAGNOSTIC'.repeat(20000));
      process.stdout.write(JSON.stringify({state:'held',path:'fixture-α',detail:'Synthetic held owner'}));
    } else process.stdout.write('${identity}');`,
      1,
      false,
    );
    try {
      const result = await f.run();
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Synthetic held owner/);
      assert.match(result.stderr, /fixture-α/);
      assert.doesNotMatch(
        await readFile(join(f.repo, 'launcher.log'), 'utf8'),
        /PRIVATE_HELPER_DIAGNOSTIC/,
      );
      assert.ok(result.elapsed < 6000);
    } finally {
      await f.close();
    }
  },
);

test('sanitizes malformed ownership JSON including parser errors', { skip: !native }, async () => {
  const f = await fixture(
    `process.stdout.write(process.argv[2] === '--store-state'
    ? '{PRIVATE_HELPER_OUTPUT}' : '${identity}');`,
    1,
    false,
  );
  try {
    const result = await f.run();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ownership.*invalid output/);
    assert.doesNotMatch(
      await readFile(join(f.repo, 'launcher.log'), 'utf8'),
      /PRIVATE_HELPER_OUTPUT/,
    );
  } finally {
    await f.close();
  }
});
