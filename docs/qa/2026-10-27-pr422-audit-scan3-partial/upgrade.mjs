import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as L from './lib.mjs';
const { createClient } = createRequire(path.join(L.REPO, 'packages/infrastructure/package.json'))(
  '@libsql/client',
);
let api;
const E = { before: {}, after: {} };
const ids = {};
const marker = path.join(L.ROOT, 'upgrade-running-marker');
const release = path.join(L.ROOT, 'upgrade-running-release');
async function sql(query) {
  const client = createClient({
    url: 'file:' + path.join(L.ROOT, 'upgrade-store', 'graphgoblin.db'),
  });
  try {
    return (await client.execute(query)).rows;
  } finally {
    client.close();
  }
}
try {
  const baseline = path.join(L.RECORD, 'baseline-entry.mjs');
  api = await L.startApi(
    'upgrade-store',
    6654,
    { GG_QA_ROOT: L.ROOT, GG_MAX_CONCURRENT_RUNS: '1', GG_LOG_LEVEL: 'info' },
    baseline,
  );
  const minimal = await L.publish(api, L.loop('Upgrade succeeded'));
  ids.succeeded = (await L.run(api, minimal)).id;
  await L.state(api, ids.succeeded, ['succeeded']);
  const exhausted = L.loop('Upgrade exhausted');
  exhausted.nodes.at(-1).config = { outcome: 'exhausted' };
  ids.exhausted = (await L.run(api, await L.publish(api, exhausted))).id;
  await L.state(api, ids.exhausted, ['exhausted']);
  ids.failed = (
    await L.run(
      api,
      await L.publish(
        api,
        L.loop('Upgrade script failure', [
          L.scriptNode(path.join(L.RECORD, 'effect.mjs'), [
            'exit',
            path.join(L.ROOT, 'upgrade-failed-marker'),
            path.join(L.ROOT, 'upgrade-failed-release'),
          ]),
        ]),
      ),
    )
  ).id;
  await L.state(api, ids.failed, ['failed']);
  const parkLoop = await L.publish(api, L.loop('Upgrade wait', [L.waitNode()]));
  ids.waiting = (await L.run(api, parkLoop)).id;
  await L.state(api, ids.waiting, ['waiting']);
  ids.paused = (await L.run(api, parkLoop)).id;
  await L.state(api, ids.paused, ['waiting']);
  await api.post(`/runs/${ids.paused}/pause`);
  await L.state(api, ids.paused, ['paused']);
  ids.cancelled = (await L.run(api, parkLoop)).id;
  await L.state(api, ids.cancelled, ['waiting']);
  await api.post(`/runs/${ids.cancelled}/cancel`);
  await L.state(api, ids.cancelled, ['cancelled']);
  const forks = [];
  for (let i = 0; i < 2; i++) {
    const fork = await api.post(`/runs/${ids.succeeded}/replay`, { nodeId: 'done' });
    forks.push(fork.run.id);
    await L.state(api, fork.run.id, ['succeeded']);
  }
  ids.running = (
    await L.run(
      api,
      await L.publish(
        api,
        L.loop('Upgrade running', [
          L.scriptNode(path.join(L.RECORD, 'effect.mjs'), ['hold', marker, release]),
        ]),
      ),
    )
  ).id;
  await L.until(() => fs.existsSync(marker));
  ids.queued = (await L.run(api, minimal)).id;
  await L.state(api, ids.queued, ['queued']);
  for (const [name, id] of Object.entries(ids)) E.before[name] = await api.get('/runs/' + id);
  E.ids = ids;
  E.forks = forks;
  E.oldForks = await sql(
    'SELECT id,replay_source_run_id FROM runs WHERE replay_source_run_id IS NOT NULL',
  );
  E.oldLedger = await sql('SELECT * FROM __drizzle_migrations ORDER BY id');
  E.oldObjects = await sql(
    "SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name",
  );
  await api.kill();
  fs.writeFileSync(release, 'release original');
  await L.sleep(150);
  api = await L.startApi('upgrade-store', 6654);
  for (const [name, id] of Object.entries(ids)) E.after[name] = await api.get('/runs/' + id);
  E.newForks = await sql(
    'SELECT id,replay_source_run_id,replay_intent_node_id,replay_intent_observed_seq FROM runs WHERE replay_source_run_id IS NOT NULL',
  );
  E.newLedger = await sql('SELECT * FROM __drizzle_migrations ORDER BY id');
  E.newObjects = await sql(
    "SELECT type,name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name",
  );
  L.check(
    'main store contains every execution status before upgrade',
    new Set(Object.values(E.before).map((r) => r.status)).size === 8,
    Object.fromEntries(Object.entries(E.before).map(([k, v]) => [k, v.status])),
  );
  L.check('migration 0024 and 0025 add two ledger entries', E.newLedger.length === E.oldLedger.length + 2, {
    before: E.oldLedger.length,
    after: E.newLedger.length,
  });
  L.check(
    'old replay forks retain source with empty intent fields',
    E.newForks.length === 2 &&
      E.newForks.every(
        (r) =>
          r.replay_source_run_id === ids.succeeded &&
          r.replay_intent_node_id === null &&
          r.replay_intent_observed_seq === null,
      ),
    E.newForks,
  );
  L.check(
    'upgrade preserves existing indexes and triggers',
    E.oldObjects.every((a) =>
      E.newObjects.some((b) => a.name === b.name && a.type === b.type && a.sql === b.sql),
    ),
    { before: E.oldObjects.map((r) => r.name), after: E.newObjects.map((r) => r.name) },
  );
  let paused = await api.get('/runs/' + ids.paused);
  let resume = await api.call('POST', `/runs/${ids.paused}/resume`, {
    observedSeq: paused.recovery.observedSeq,
  });
  let waiting = await L.state(api, ids.paused, ['waiting']);
  L.check(
    'upgraded paused run resumes its same park',
    resume.status === 200 && waiting.waiting.waitId === E.before.paused.waiting.waitId,
    { resume, waiting },
  );
  E.pausedResume = { resume, waiting };
  let failed = await api.get('/runs/' + ids.failed);
  fs.writeFileSync(path.join(L.ROOT, 'upgrade-failed-release'), 'fixed');
  resume = await api.call('POST', `/runs/${ids.failed}/resume`, {
    observedSeq: failed.recovery.observedSeq,
  });
  await L.state(api, ids.failed, ['succeeded']);
  L.check('upgraded SCRIPT_EXIT_CODE run resumes', resume.status === 200, resume);
  const source = await api.get('/runs/' + ids.succeeded);
  const replay = await api.call('POST', `/runs/${ids.succeeded}/replay`, {
    nodeId: 'done',
    observedSeq: source.recovery.observedSeq,
  });
  L.check(
    'old source accepts new observed Replay despite historical unobserved forks',
    replay.status === 202,
    replay,
  );
  E.newReplay = replay;
  await api.stop();
  api = await L.startApi('upgrade-store', 6654);
  E.secondLedger = await sql('SELECT * FROM __drizzle_migrations ORDER BY id');
  L.check(
    'second reopen does not reapply 0024 or 0025',
    JSON.stringify(E.secondLedger) === JSON.stringify(E.newLedger),
    E.secondLedger,
  );
} catch (error) {
  E.error = String(error.stack);
  console.log(L.redact(error.stack));
  L.check('upgrade driver completed', false, E.error);
} finally {
  await L.cleanup();
  L.save(
    'upgrade-processes.json',
    L.processes.map((p) => ({
      pid: p.child.pid,
      code: p.child.exitCode,
      signal: p.child.signalCode,
    })),
  );
  L.save('upgrade-results.json', { checks: L.checks, evidence: E });
}
process.exitCode = L.checks.some((c) => !c.passed) ? 1 : 0;
