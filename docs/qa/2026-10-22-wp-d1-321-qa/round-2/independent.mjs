// Independent QA against the built <repo> API; no provider turns or product edits.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/[\\/]$/, '');
const expectedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
}).trim();
const results = [],
  observations = [],
  fixtures = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function safe(value) {
  let text = String(value);
  for (const prefix of [repo, process.env.USERPROFILE].filter(Boolean)) {
    for (const version of [prefix.replaceAll('\\', '\\\\'), prefix.replaceAll('\\', '/'), prefix])
      text = text.replaceAll(version, prefix === repo ? '<repo>' : '<user>');
  }
  return text.replace(/\bgg_[A-Za-z0-9_-]+/g, '[redacted-key]');
}
async function save(name, value) {
  await fs.writeFile(join(out, name), safe(JSON.stringify(value, null, 2)) + '\n');
}
async function until(check, ms = 60000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(50);
  }
  throw new Error('QA state deadline exceeded');
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    throw e;
  }
}
async function check(id, steps, expected, test) {
  const started = Date.now();
  try {
    results.push({
      id,
      steps,
      expected,
      status: 'PASS',
      actual: await test(),
      seconds: (Date.now() - started) / 1000,
    });
  } catch (error) {
    results.push({
      id,
      steps,
      expected,
      status: 'FAIL',
      actual: safe(error.stack ?? error),
      seconds: (Date.now() - started) / 1000,
    });
  }
  await save('independent-results.json', { head: expectedHead, checks: results });
  process.stdout.write(`${results.at(-1).status}: ${id}\n`);
}
async function launch(command, args, env, cwd = repo) {
  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => {
    log += b;
  });
  child.stderr.on('data', (b) => {
    log += b;
  });
  const exit = new Promise((resolve, reject) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  });
  return { child, exit, log: () => log };
}
async function fixture() {
  let port;
  for (const candidate of [5928, 5929, 5920, 5921, 5922, 5923, 5924, 5925, 5926, 5927]) {
    const listener = createServer();
    const free = await new Promise((resolve, reject) => {
      listener.once('error', (e) => (e.code === 'EADDRINUSE' ? resolve(false) : reject(e)));
      listener.listen(candidate, '127.0.0.1', () => listener.close(() => resolve(true)));
    });
    if (free) {
      port = candidate;
      break;
    }
  }
  assert.ok(port, 'No free permitted QA API port');
  const dir = await fs.mkdtemp(join(tmpdir(), 'gg-qa-321-r2-independent-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) =>
        !k.toUpperCase().startsWith('GG_') &&
        !['JEV_API_KEY', 'NODE_V8_COVERAGE'].includes(k.toUpperCase()),
    ),
  );
  Object.assign(env, {
    LIVE: '0',
    GG_DATA_DIR: dir,
    GG_DB_URL: `file:${join(dir, 'graphgoblin.db')}`,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_REQUIRE_API_KEY: 'false',
    GG_JEV_API_KEY: '',
    GG_MASTER_KEY: Buffer.alloc(32, 4).toString('base64'),
    GG_WEB_DIST: join(repo, 'apps/web/dist'),
  });
  const servers = [],
    releases = [];
  let server;
  const f = {
    dir,
    port,
    origin: `http://127.0.0.1:${port}`,
    servers,
    releases,
    async boot() {
      server = await launch(process.execPath, [join(repo, 'apps/api/dist/main.js')], env);
      servers.push(server);
      await until(async () => {
        if (server.child.exitCode !== null || server.child.signalCode !== null)
          throw new Error(`QA API exited: ${safe(server.log().slice(-3000))}`);
        if (!server.log().includes('GraphGoblin API listening')) return false;
        try {
          return (await fetch(f.origin + '/loops')).ok;
        } catch {
          return false;
        }
      });
    },
    async kill() {
      server.child.kill('SIGKILL');
      return await server.exit;
    },
    async call(method, path, body = {}) {
      const response = await fetch(f.origin + path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
      return await response.json();
    },
    get(id) {
      return f.call('GET', `/runs/${id}`);
    },
    async events(id) {
      return (await f.call('GET', `/runs/${id}/events?limit=500`)).items;
    },
    async state(id, status) {
      return until(async () => {
        const run = await f.get(id);
        return run.status === status && run;
      });
    },
    async loop(name, middle, before = [], after = []) {
      const nodes = [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        ...before,
        middle,
        ...after,
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ];
      const definition = {
        schemaVersion: 4,
        name,
        nodes,
        edges: nodes.slice(1).map((node, index) => ({
          id: `e${index}`,
          from: { node: nodes[index].id, port: 'out' },
          to: { node: node.id },
        })),
      };
      const { loop } = await f.call('POST', '/loops', { definition });
      await f.call('POST', `/loops/${loop.id}/publish`);
      return loop;
    },
    async start(loop) {
      return (await f.call('POST', `/loops/${loop.id}/runs`, { triggerNodeId: 'start' })).run;
    },
    probe(name) {
      const marker = join(dir, `${name}.marker`),
        release = join(dir, `${name}.release`);
      releases.push(release);
      return {
        marker,
        release,
        node: {
          id: 'script',
          kind: 'script',
          label: 'Marker effect',
          config: {
            command: process.execPath,
            args: [
              join(repo, 'apps/api/scripts/uncertain-script-marker.mjs'),
              marker,
              release,
              '120000',
            ],
            cwd: dir,
          },
        },
        async count() {
          try {
            return (await fs.readFile(marker, 'utf8')).match(/effect\n/g)?.length ?? 0;
          } catch (e) {
            if (e.code === 'ENOENT') return 0;
            throw e;
          }
        },
        async allow() {
          await fs.writeFile(release, 'done');
        },
        async hold() {
          await fs.rm(release, { force: true });
        },
        async stopped() {
          await until(async () =>
            (await fs.readdir(dir))
              .filter((n) => n.startsWith(`${name}.marker.active-`))
              .every((n) => !alive(Number(n.split('-').at(-1)))),
          );
        },
      };
    },
    async dispose() {
      for (const release of releases) await fs.writeFile(release, 'done');
      for (const s of servers) {
        if (s.child.exitCode === null && s.child.signalCode === null) s.child.kill('SIGKILL');
        await s.exit;
      }
      await until(async () => {
        for (const n of (await fs.readdir(dir)).filter(
          (n) => n.includes('.marker.active-') || n.endsWith('.pid'),
        )) {
          const pid = n.endsWith('.pid')
            ? Number(await fs.readFile(join(dir, n), 'utf8'))
            : Number(n.split('-').at(-1));
          if (alive(pid)) return false;
        }
        return true;
      });
      return {
        store: basename(dir),
        port,
        apiProcesses: servers.map((s) => ({
          pid: s.child.pid,
          exited: s.child.exitCode !== null || s.child.signalCode !== null,
        })),
        markerProcessesExited: true,
        nativeProbeProcessesExited: true,
      };
    },
  };
  fixtures.push(f);
  await save('runtime.json', {
    head: expectedHead,
    stores: fixtures.map((s) => ({ store: basename(s.dir), port: s.port })),
  });
  await f.boot();
  return f;
}
const wait = (id) => ({ id, kind: 'wait', label: id, config: { mode: 'input', prompt: id } });
const summary = (run) => ({ id: run.id, status: run.status, failure: run.failure });
let browser;
try {
  const f = await fixture();
  await check(
    'before-dispatch',
    'Park before script, hard kill API, restart same store, submit observed waitId.',
    'No dispatch before input; success with one effect.',
    async () => {
      const p = f.probe('before');
      await p.allow();
      const run = await f.start(await f.loop('Round 2 before', p.node, [wait('before')]));
      await f.state(run.id, 'waiting');
      assert.equal(await p.count(), 0);
      await f.kill();
      await f.boot();
      const parked = await f.state(run.id, 'waiting');
      assert.equal(
        (await f.events(run.id)).filter((e) => e.type === 'script.dispatched').length,
        0,
      );
      await f.call('POST', `/runs/${run.id}/input`, { waitId: parked.waiting.waitId, input: null });
      await f.state(run.id, 'succeeded');
      assert.equal(await p.count(), 1);
      return { effects: 1, runId: run.id };
    },
  );
  await check(
    'interrupted-dispatch-and-resumed-dispatch',
    'Kill after live marker effect; restart twice without consent; Resume; kill second live dispatch; restart; deliberately Resume again.',
    'Uncertainty preserves original IDs; no automatic repeat; same visit and fresh dispatch on each Resume; final success.',
    async () => {
      const p = f.probe('twice');
      const run = await f.start(await f.loop('Round 2 twice interrupted', p.node));
      await until(async () => (await p.count()) === 1);
      const first = (await f.events(run.id)).find((e) => e.type === 'script.dispatched');
      assert.ok(first);
      await f.kill();
      await p.allow();
      await p.stopped();
      await f.boot();
      const failed = await f.state(run.id, 'failed');
      assert.equal(failed.failure.code, 'SCRIPT_OUTCOME_UNCERTAIN');
      assert.equal(failed.failure.resumable, true);
      assert.deepEqual(failed.failure.script, {
        visitId: first.visitId,
        dispatchId: first.dispatchId,
        state: 'outcome-uncertain',
      });
      await f.kill();
      await f.boot();
      await pause(400);
      assert.equal(await p.count(), 1);
      assert.equal(
        (await f.events(run.id)).filter((e) => e.type === 'script.dispatched').length,
        1,
      );
      await p.hold();
      await f.call('POST', `/runs/${run.id}/resume`);
      await until(async () => (await p.count()) === 2);
      const second = (await f.events(run.id)).filter((e) => e.type === 'script.dispatched').at(-1);
      assert.equal(second.visitId, first.visitId);
      assert.notEqual(second.dispatchId, first.dispatchId);
      await f.kill();
      await p.allow();
      await p.stopped();
      await f.boot();
      const again = await f.state(run.id, 'failed');
      assert.deepEqual(again.failure.script, {
        visitId: second.visitId,
        dispatchId: second.dispatchId,
        state: 'outcome-uncertain',
      });
      assert.equal(await p.count(), 2);
      await f.call('POST', `/runs/${run.id}/resume`);
      await f.state(run.id, 'succeeded');
      assert.equal(await p.count(), 3);
      return {
        firstFailure: failed.failure,
        secondFailure: again.failure,
        effectsBeforeConsent: 1,
        effectsAfterSecondKill: 2,
        finalEffects: 3,
        dispatches: (await f.events(run.id)).filter((e) => e.type === 'script.dispatched'),
      };
    },
  );
  await check(
    'completed-before-cursor',
    'Inject disposable SQLite cursor-write and error-disposition faults; finish marker; verify durable node.finished with old script cursor; hard kill; remove faults; restart.',
    'Durable completion advances without another dispatch or effect.',
    async () => {
      const p = f.probe('cursor');
      const run = await f.start(await f.loop('Round 2 lost cursor', p.node));
      await until(async () => (await p.count()) === 1);
      const require = createRequire(join(repo, 'packages/infrastructure/package.json'));
      const { createClient } = require('@libsql/client');
      const db = createClient({ url: `file:${join(f.dir, 'graphgoblin.db')}` });
      try {
        await db.execute(
          `CREATE TRIGGER qa_cursor BEFORE UPDATE OF current_node_id ON runs WHEN OLD.id='${run.id}' AND OLD.current_node_id='script' AND NEW.current_node_id='done' BEGIN SELECT RAISE(ABORT,'QA_CURSOR_FAULT'); END`,
        );
        await db.execute(
          `CREATE TRIGGER qa_failure BEFORE INSERT ON run_events WHEN NEW.run_id='${run.id}' AND NEW.type='run.failed' BEGIN SELECT RAISE(ABORT,'QA_DISPOSITION_FAULT'); END`,
        );
        await p.allow();
        await p.stopped();
        await until(
          async () =>
            Number(
              (
                await db.execute({
                  sql: "SELECT count(*) AS n FROM run_events WHERE run_id=? AND type='node.finished' AND node_id='script'",
                  args: [run.id],
                })
              ).rows[0].n,
            ) === 1,
        );
        const row = (
          await db.execute({
            sql: 'SELECT current_node_id,status FROM runs WHERE id=?',
            args: [run.id],
          })
        ).rows[0];
        assert.equal(row.current_node_id, 'script');
        assert.equal(row.status, 'running');
        const killed = await f.kill();
        await db.execute('DROP TRIGGER qa_cursor');
        await db.execute('DROP TRIGGER qa_failure');
        await f.boot();
        await f.state(run.id, 'succeeded');
        assert.equal(await p.count(), 1);
        assert.equal(
          (await f.events(run.id)).filter((e) => e.type === 'script.dispatched').length,
          1,
        );
        return {
          preKill: row,
          killed,
          effects: 1,
          dispatches: 1,
          method: 'controlled real SQLite storage fault followed by real API kill',
        };
      } finally {
        await db.execute('DROP TRIGGER IF EXISTS qa_cursor');
        await db.execute('DROP TRIGGER IF EXISTS qa_failure');
        db.close();
      }
    },
  );
  const terminalRuns = {};
  for (const kind of ['missing', 'cmd', 'nonzero', 'timeout', 'cancel'])
    await check(
      `native-${kind}`,
      'Publish and run the real local command; inspect typed failure; repair missing executable in place and Resume.',
      'Start refusal is resumable/definitely-not-started; exit 7 preserves completed provenance; timeout/cancel classification stays correct.',
      async () => {
        let config = { command: process.execPath, args: ['-e', 'process.exit(7)'], cwd: f.dir };
        const command = join(f.dir, kind === 'cmd' ? 'refusal.cmd' : 'repair.exe');
        if (kind === 'missing') config = { command, args: ['-e', 'process.exit(0)'], cwd: f.dir };
        if (kind === 'cmd') {
          await fs.writeFile(command, '@echo off\r\nexit /b 0\r\n');
          config = { command, cwd: f.dir };
        }
        if (kind === 'timeout' || kind === 'cancel')
          config = {
            command: process.execPath,
            args: [
              '-e',
              "require('node:fs').writeFileSync(process.argv[1],String(process.pid));setTimeout(()=>{},5000)",
              join(f.dir, `${kind}.pid`),
            ],
            cwd: f.dir,
            ...(kind === 'timeout' ? { timeoutSeconds: 1 } : {}),
          };
        const run = await f.start(
          await f.loop(`Round 2 ${kind}`, { id: 'script', kind: 'script', label: kind, config }),
        );
        terminalRuns[kind] = run.id;
        if (kind === 'cancel') {
          await until(async () =>
            (await f.events(run.id)).some((e) => e.type === 'script.dispatched'),
          );
          await pause(300);
          await f.call('POST', `/runs/${run.id}/cancel`);
          const done = await f.state(run.id, 'cancelled');
          assert.equal(done.failure, undefined);
          return {
            ...summary(done),
            qualification:
              'Finite 5-second process: classification only; timely tree termination is D-015-limited.',
          };
        }
        const failed = await f.state(run.id, 'failed');
        assert.equal(
          failed.failure.code,
          {
            missing: 'SCRIPT_START_FAILED',
            cmd: 'SCRIPT_START_FAILED',
            nonzero: 'SCRIPT_EXIT_CODE',
            timeout: 'SCRIPT_TIMEOUT',
          }[kind],
        );
        assert.equal(failed.failure.resumable, true);
        assert.ok(failed.failure.script.visitId);
        assert.ok(failed.failure.script.dispatchId);
        if (['missing', 'cmd'].includes(kind))
          assert.equal(failed.failure.script.state, 'definitely-not-started');
        if (kind === 'nonzero') {
          assert.equal(failed.failure.script.state, 'completed');
          assert.equal(failed.failure.script.exitCode, 7);
          assert.equal(failed.failure.details.exitCode, 7);
        }
        if (kind === 'missing') {
          await fs.copyFile(process.execPath, command);
          await f.call('POST', `/runs/${run.id}/resume`);
          await f.state(run.id, 'succeeded');
        }
        return {
          ...summary(failed),
          repairResumed: kind === 'missing',
          ...(kind === 'timeout'
            ? {
                qualification:
                  'Finite 5-second process: classification only; timely tree termination is D-015-limited.',
              }
            : {}),
        };
      },
    );
  const webRequire = createRequire(join(repo, 'apps/web/package.json'));
  const { chromium, expect } = webRequire('@playwright/test');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  async function uncertain(name, parent = false) {
    const p = f.probe(name);
    let loop;
    if (parent) {
      const child = await f.loop(`${name} child`, p.node);
      loop = await f.loop(`${name} parent`, {
        id: 'sub',
        kind: 'subloop',
        label: 'Child work',
        config: { loopRef: { loopId: child.id } },
      });
    } else loop = await f.loop(name, p.node);
    const run = await f.start(loop);
    await until(async () => (await p.count()) === 1);
    await f.kill();
    await p.allow();
    await p.stopped();
    await f.boot();
    const failed = await f.state(run.id, 'failed');
    assert.equal(failed.failure.code, 'SCRIPT_OUTCOME_UNCERTAIN');
    return { p, run, failed };
  }
  await check(
    'edge-cancel-live-resume',
    'Open uncertain inspector in Edge; Cancel recovery; Resume while marker held; release and observe final status.',
    'Count remains 1 after Cancel; explicit Resume makes 2; success without document reload; earlier dispatch/failure retained.',
    async () => {
      const { p, run, failed } = await uncertain('Round 2 browser');
      await page.goto(`${f.origin}/app/runs/${run.id}`);
      await expect(page.getByText('Failed: SCRIPT_OUTCOME_UNCERTAIN')).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('may already have produced its effect');
      const origin = await page.evaluate(() => performance.timeOrigin);
      await page.getByRole('button', { name: 'Recover script', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Recover script' });
      await expect(dialog).toContainText('may repeat that effect');
      observations.push({ state: 'uncertain recovery dialog', text: await dialog.innerText() });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden();
      assert.equal((await f.get(run.id)).status, 'failed');
      assert.equal(await p.count(), 1);
      await p.hold();
      await page.getByRole('button', { name: 'Recover script', exact: true }).click();
      await dialog.getByRole('button', { name: 'Resume', exact: true }).click();
      await until(async () => (await p.count()) === 2);
      await expect(page.locator('[data-status="running"]')).toBeVisible();
      await p.allow();
      await f.state(run.id, 'succeeded');
      await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
      const timeline = page.getByRole('list', { name: 'Timeline' });
      await expect(timeline).toContainText('script.dispatched');
      await expect(timeline).toContainText('run.failed');
      observations.push({ state: 'successful resumed timeline', text: await timeline.innerText() });
      assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
      const dispatches = (await f.events(run.id)).filter((e) => e.type === 'script.dispatched');
      assert.equal(dispatches[0].visitId, dispatches[1].visitId);
      assert.notEqual(dispatches[0].dispatchId, dispatches[1].dispatchId);
      return {
        failure: failed.failure,
        effects: await p.count(),
        documentReloads: 0,
        browser: browser.version(),
        dispatches,
      };
    },
  );
  await check(
    'edge-replay',
    'Recover a second uncertain run with Replay.',
    'Navigate to new successful fork; source stays failed; second effect.',
    async () => {
      const { p, run } = await uncertain('Round 2 Replay');
      await page.goto(`${f.origin}/app/runs/${run.id}`);
      await page.getByRole('button', { name: 'Recover script', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Recover script' })
        .getByRole('button', { name: 'Replay', exact: true })
        .click();
      await expect(page).not.toHaveURL(`${f.origin}/app/runs/${run.id}`);
      const forkId = new URL(page.url()).pathname.split('/').at(-1);
      await f.state(forkId, 'succeeded');
      assert.equal((await f.get(run.id)).status, 'failed');
      assert.equal(await p.count(), 2);
      return { sourceId: run.id, forkId, effects: 2 };
    },
  );
  let ordinaryId;
  await check(
    'edge-non-script-failure',
    'Fail a mutation expression and inspect its run.',
    'No Recover script button and no failure.script.',
    async () => {
      const run = await f.start(
        await f.loop('Round 2 ordinary failure', {
          id: 'mutation',
          kind: 'mutate',
          label: 'Invalid expression',
          config: {
            operations: [
              {
                op: 'set',
                path: '/vars/x',
                value: { kind: 'expression', jsonata: '$error("QA failure")' },
              },
            ],
          },
        }),
      );
      ordinaryId = run.id;
      const failed = await f.state(run.id, 'failed');
      await page.goto(`${f.origin}/app/runs/${run.id}`);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Recover script' })).toHaveCount(0);
      assert.equal(failed.failure.script, undefined);
      return summary(failed);
    },
  );
  await check(
    'child-in-place',
    'Kill API during child marker; inspect failed parent; Resume parent using Edge recovery dialog.',
    'Parent inherits code/resumability; same child resumes; exactly one additional child effect.',
    async () => {
      const { p, run, failed } = await uncertain('Round 2 child', true);
      assert.equal(failed.failure.resumable, true);
      const childId = failed.failure.details.childRunId;
      const child = await f.get(childId);
      assert.equal(child.failure.code, failed.failure.code);
      await page.goto(`${f.origin}/app/runs/${run.id}`);
      await page.getByRole('button', { name: 'Recover script', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Recover script' })
        .getByRole('button', { name: 'Resume', exact: true })
        .click();
      await f.state(run.id, 'succeeded');
      await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
      assert.equal(await p.count(), 2);
      const starts = (await f.events(run.id)).filter((e) => e.type === 'child_run.started');
      assert.equal(starts.length, 1);
      assert.equal(starts[0].childRunId, childId);
      return {
        parentFailure: failed.failure,
        childFailure: child.failure,
        childId,
        childStartCount: 1,
        effects: 2,
      };
    },
  );
  await check(
    'edge-keyboard-narrow-concurrent-resume',
    'Use 375px Edge, keyboard open/Escape, second tab, then concurrent explicit API Resume requests.',
    'Dialog fits; opening/cancelling has no effect; one resumed dispatch; duplicate gets 409.',
    async () => {
      const { p, run } = await uncertain('Round 2 narrow');
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${f.origin}/app/runs/${run.id}`);
      await page.getByRole('button', { name: 'Recover script', exact: true }).focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Recover script' });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 376);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      assert.equal(await p.count(), 1);
      assert.equal((await f.get(run.id)).status, 'failed');
      const second = await context.newPage();
      await second.goto(`${f.origin}/app/runs/${run.id}`);
      await second.getByRole('button', { name: 'Recover script', exact: true }).click();
      await p.hold();
      const responses = await Promise.allSettled([
        f.call('POST', `/runs/${run.id}/resume`),
        f.call('POST', `/runs/${run.id}/resume`),
      ]);
      assert.equal(responses.filter((r) => r.status === 'fulfilled').length, 1);
      assert.match(responses.find((r) => r.status === 'rejected').reason.message, /: 409 /);
      await until(async () => (await p.count()) === 2);
      assert.equal(
        (await f.events(run.id)).filter((e) => e.type === 'script.dispatched').length,
        2,
      );
      await p.allow();
      await f.state(run.id, 'succeeded');
      await second.close();
      return {
        dialogBox: box,
        effects: 2,
        requests: responses.map((r) =>
          r.status === 'fulfilled' ? 'accepted' : safe(r.reason.message),
        ),
      };
    },
  );
  await check(
    'api-client-mcp-provenance',
    'Use built public client to GET real script failure; invoke MCP get_run/read_run_events/list_runs and list tools via in-memory transport.',
    'Failure provenance round-trips; summaries include script/resumable for scripts only; Resume description requires explicit choice.',
    async () => {
      const require = createRequire(join(repo, 'apps/mcp/package.json'));
      const { createMcpServer, summarizeRun } = await import(
        pathToFileURL(join(repo, 'apps/mcp/dist/index.js'))
      );
      const { createGraphGoblinClient, runs } = await import(
        pathToFileURL(join(repo, 'packages/api-client/dist/index.js'))
      );
      const client = createGraphGoblinClient({ baseUrl: f.origin, client: 'mcp' });
      const script = await runs.get(client, terminalRuns.nonzero);
      const ordinary = await f.get(ordinaryId);
      assert.ok(script.failure.script.dispatchId);
      const scriptSummary = summarizeRun(script),
        ordinarySummary = summarizeRun(ordinary);
      assert.deepEqual(scriptSummary.failure.script, script.failure.script);
      assert.equal(scriptSummary.failure.resumable, true);
      assert.equal('script' in ordinarySummary.failure, false);
      assert.equal('resumable' in ordinarySummary.failure, false);
      const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const [a, b] = InMemoryTransport.createLinkedPair();
      const server = createMcpServer({ apiUrl: f.origin });
      const mcp = new Client({ name: 'qa-321-round-2', version: '1' });
      await server.connect(a);
      await mcp.connect(b);
      try {
        const tools = await mcp.listTools();
        const description = tools.tools.find((t) => t.name === 'resume_run').description;
        assert.match(description, /only when the user explicitly chooses to retry/);
        const unpack = (r) => {
          assert.equal(r.isError, undefined);
          return JSON.parse(r.content.find((c) => c.type === 'text').text);
        };
        const get = unpack(
          await mcp.callTool({ name: 'get_run', arguments: { runId: script.id } }),
        );
        assert.deepEqual(get.failure.script, script.failure.script);
        const events = unpack(
          await mcp.callTool({
            name: 'read_run_events',
            arguments: { runId: script.id, limit: 100 },
          }),
        );
        assert.ok(events.items.some((e) => e.type === 'script.dispatched'));
        return {
          publicClientFailure: script.failure,
          scriptSummary: scriptSummary.failure,
          ordinarySummary: ordinarySummary.failure,
          resumeDescription: description,
          mcpGetFailure: get.failure,
          eventTypes: events.items.map((e) => e.type),
        };
      } finally {
        await mcp.close();
        await server.close();
      }
    },
  );
  await save('corrected-edge-observations.json', observations);
} catch (error) {
  await save('fatal.json', { head: expectedHead, error: safe(error.stack ?? error) });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  const exitRecords = [];
  for (const f of fixtures) {
    try {
      exitRecords.push(await f.dispose());
    } catch (error) {
      exitRecords.push({ store: basename(f.dir), error: safe(error.stack ?? error) });
      process.exitCode = 1;
    }
  }
  await save('process-exit.json', { head: expectedHead, stores: exitRecords });
  await save('independent-results.json', { head: expectedHead, checks: results });
  await save('corrected-results.json', {
    head: expectedHead,
    note: 'Fresh round-2 observations from reconstructed corrected probes; not recovered historical results.',
    checks: results,
  });
  if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
}
