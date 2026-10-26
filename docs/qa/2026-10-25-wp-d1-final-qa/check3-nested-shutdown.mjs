// Check 3: ordinary drain and forced stop with nested children running or parked, then restart.
// Run: node --expose-gc check3-nested-shutdown.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  apiStore, chain, countType, eventually, exitNode, logger, makeDataDir, removeDir, scriptNode,
  sleep, subNode, TERMINAL, worktree, writeJson,
} from './lib.mjs';

const { openReadOnlyDatabaseClient } = await import(
  pathToFileURL(join(worktree, 'packages/infrastructure/dist/sqlite/db.js')).href
);
const log = logger('check3-nested-shutdown');
const PORT = Number(process.env.QA_PORT ?? 6390);
const violations = [];
const live = [];
const results = { phases: {} };
const violate = (where, what, extra) => {
  violations.push({ where, what, ...(extra ? { extra } : {}) });
  log('VIOLATION', where, what, extra ?? '');
};
const expectEq = (where, label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) violate(where, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const lineCount = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0);

async function storedStatuses(dataDir, ids) {
  const client = openReadOnlyDatabaseClient(join(dataDir, 'graphgoblin.db'));
  try {
    const rows = (await client.execute(`SELECT id, status, waiting, failure FROM runs`)).rows;
    const map = Object.fromEntries(rows.map((r) => [r.id, { status: r.status, waitId: r.waiting ? JSON.parse(r.waiting).waitId : undefined, failure: r.failure ? JSON.parse(r.failure).code : undefined }]));
    return Object.fromEntries(Object.entries(ids).map(([label, id]) => [label, map[id]]));
  } finally {
    client.close();
    globalThis.gc?.();
  }
}

async function family(store, topLoop) {
  const top = await store.startRun(topLoop);
  const middle = await eventually(async () => (await store.children(top.id))[0], 60_000, 'middle');
  const leaf = await eventually(async () => (await store.children(middle.id))[0], 60_000, 'leaf');
  return { top: top.id, middle: middle.id, leaf: leaf.id };
}

async function verifyFamily(store, f, where, { childFinishes }) {
  const out = {};
  for (const [label, id] of [['top', f.top], ['middle', f.middle]]) {
    const events = await store.events(id);
    const children = await store.children(id);
    out[label] = {
      status: (await store.run(id)).status,
      childStarts: countType(events, 'child_run.started'),
      childFinishes: events.filter((e) => e.type === 'child_run.finished').map((e) => e.status),
      children: children.length,
    };
    expectEq(where, `${label} ${id} child_run.started`, out[label].childStarts, 1);
    expectEq(where, `${label} ${id} children`, out[label].children, 1);
    expectEq(where, `${label} ${id} child_run.finished`, out[label].childFinishes, childFinishes);
  }
  out.leaf = { status: (await store.run(f.leaf)).status };
  return out;
}

async function phaseDrain(dataDir) {
  const where = '3A ordinary drain with nested children running and parked';
  const effectsFile = join(dataDir, 'drain-effects.txt');
  const store = apiStore({ dataDir, port: PORT, log, env: { GG_MAX_CONCURRENT_RUNS: '2' } });
  live.push(store);
  await store.start();
  const work = `const fs=require('node:fs');fs.appendFileSync(process.argv[1],'w\\n');setTimeout(()=>process.exit(0),3000)`;
  const leafInput = await store.publish(chain('QA drain leaf input', [{ id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'leaf?' } }, exitNode('outputs.ask.value')]));
  const leafWork = await store.publish(chain('QA drain leaf work', [scriptNode('work', ['-e', work, effectsFile], { stdin: 'none', stdout: 'ignore' }), exitNode('"worked"')]));
  const midInput = await store.publish(chain('QA drain middle input', [subNode(leafInput), exitNode('outputs.sub.value.result')]));
  const midWork = await store.publish(chain('QA drain middle work', [subNode(leafWork), exitNode('outputs.sub.value.result')]));
  const topInput = await store.publish(chain('QA drain top input', [subNode(midInput), exitNode('outputs.sub.value.result')]));
  const topWork = await store.publish(chain('QA drain top work', [subNode(midWork), exitNode('outputs.sub.value.result')]));
  const independent = await store.publish(chain('QA drain independent', [exitNode('"independent"')]));

  const parked = [await family(store, topInput), await family(store, topInput)];
  for (const f of parked) await eventually(async () => (await store.run(f.leaf)).status === 'waiting', 60_000, 'leaf parked');
  const parkedBefore = await Promise.all(parked.map((f) => store.run(f.leaf)));
  const active = [await family(store, topWork), await family(store, topWork)];
  await eventually(() => lineCount(effectsFile) === 2, 60_000, 'two leaf scripts running');
  const queued = [await store.startRun(independent), await store.startRun(independent)];
  const queuedStatus = await Promise.all(queued.map(async (r) => (await store.run(r.id)).status));
  const drain = await store.call('POST', '/system/shutdown', { action: 'drain' }, { allowError: true });
  const phases = [];
  const poll = setInterval(() => {
    store.call('GET', '/system/shutdown').then((s) => phases.push(`${s.phase}:${s.activeRunIds.length}`)).catch(() => undefined);
  }, 250);
  const exit = await Promise.race([store.server.exited, sleep(60_000).then(() => 'timeout')]);
  clearInterval(poll);
  const ids = {};
  parked.forEach((f, i) => Object.assign(ids, { [`parkedTop${i}`]: f.top, [`parkedMiddle${i}`]: f.middle, [`parkedLeaf${i}`]: f.leaf }));
  active.forEach((f, i) => Object.assign(ids, { [`activeTop${i}`]: f.top, [`activeMiddle${i}`]: f.middle, [`activeLeaf${i}`]: f.leaf }));
  queued.forEach((r, i) => (ids[`queued${i}`] = r.id));
  const atExit = await storedStatuses(dataDir, ids);
  expectEq(where, 'process exit after drain', exit, { code: 0, signal: null });
  for (let i = 0; i < 2; i++) {
    expectEq(where, `active family ${i} completed during drain`, [atExit[`activeTop${i}`].status, atExit[`activeMiddle${i}`].status, atExit[`activeLeaf${i}`].status], ['succeeded', 'succeeded', 'succeeded']);
    expectEq(where, `parked family ${i} stays parked`, [atExit[`parkedTop${i}`].status, atExit[`parkedMiddle${i}`].status, atExit[`parkedLeaf${i}`].status], ['waiting', 'waiting', 'waiting']);
    expectEq(where, `independent queued ${i} stays queued`, atExit[`queued${i}`].status, 'queued');
  }
  await store.start();
  const parkedAfter = await Promise.all(parked.map((f) => store.run(f.leaf)));
  parked.forEach((_, i) => expectEq(where, `parked leaf ${i} waitId kept`, parkedAfter[i].waiting?.waitId, parkedBefore[i].waiting?.waitId));
  await eventually(async () => (await Promise.all(queued.map((r) => store.run(r.id)))).every((r) => r.status === 'succeeded'), 60_000, 'queued runs resume after restart');
  for (const l of parkedAfter) await store.call('POST', `/runs/${l.id}/input`, { waitId: l.waiting.waitId, input: 'after restart' });
  await eventually(async () => (await Promise.all(parked.map((f) => store.run(f.top)))).every((r) => TERMINAL.includes(r.status)), 60_000, 'parked families finish');
  const verified = [];
  for (const f of [...parked, ...active]) verified.push(await verifyFamily(store, f, where, { childFinishes: ['succeeded'] }));
  verified.forEach((v, i) => expectEq(where, `family ${i} top`, v.top.status, 'succeeded'));
  expectEq(where, 'leaf script effects', lineCount(effectsFile), 2);
  results.phases.drain = { drainResponse: { status: drain.status, phase: drain.body?.phase, activeRunIds: drain.body?.activeRunIds }, queuedStatusBeforeDrain: queuedStatus, phases: [...new Set(phases)], exit, atExit, parkedWaitIdsKept: parkedAfter.map((l, i) => l.waiting?.waitId === parkedBefore[i].waiting?.waitId), verified, effects: lineCount(effectsFile) };
  log(where, JSON.stringify(results.phases.drain));
  await store.call('POST', '/system/shutdown', { action: 'drain' });
  results.phases.drain.finalExit = await store.server.exited;
}

async function phaseForce(dataDir) {
  const where = '3B forced stop with nested children running and parked';
  const effectsFile = join(dataDir, 'force-effects.txt');
  const release = join(dataDir, 'force-release');
  const store = apiStore({ dataDir, port: PORT, log, env: { GG_MAX_CONCURRENT_RUNS: '2' } });
  live.push(store);
  await store.start();
  const work = `const fs=require('node:fs');fs.appendFileSync(process.argv[1],'w\\n');const t=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(t);process.exit(0)}},25);setTimeout(()=>process.exit(0),120000)`;
  const leafInput = await store.publish(chain('QA force leaf input', [{ id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'leaf?' } }, exitNode('outputs.ask.value')]));
  const leafWork = await store.publish(chain('QA force leaf work', [scriptNode('work', ['-e', work, effectsFile, release], { stdin: 'none', stdout: 'ignore' }), exitNode('"worked"')]));
  const midInput = await store.publish(chain('QA force middle input', [subNode(leafInput), exitNode('outputs.sub.value.result')]));
  const midWork = await store.publish(chain('QA force middle work', [subNode(leafWork), exitNode('outputs.sub.value.result')]));
  const topInput = await store.publish(chain('QA force top input', [subNode(midInput), exitNode('outputs.sub.value.result')]));
  const topWork = await store.publish(chain('QA force top work', [subNode(midWork), exitNode('outputs.sub.value.result')]));
  const independent = await store.publish(chain('QA force independent', [exitNode('"independent"')]));

  const parked = await family(store, topInput);
  await eventually(async () => (await store.run(parked.leaf)).status === 'waiting', 60_000, 'leaf parked');
  const parkedBefore = await store.run(parked.leaf);
  const active = [await family(store, topWork), await family(store, topWork)];
  await eventually(() => lineCount(effectsFile) === 2, 60_000, 'two leaf scripts running');
  const queued = await store.startRun(independent);
  // SSE on a parent waiting on an interrupted child: it must not report the parent failing at force time.
  const sse = await fetch(`${store.origin}/runs/${active[0].top}/events?after=0`, { headers: { accept: 'text/event-stream' } });
  const sseText = sse.text().catch((e) => `stream error ${e}`);
  const drain = await store.call('POST', '/system/shutdown', { action: 'drain' }, { allowError: true });
  await sleep(700);
  const draining = await store.call('GET', '/system/shutdown');
  const force = await store.call('POST', '/system/shutdown', { action: 'force' }, { allowError: true });
  const exit = await Promise.race([store.server.exited, sleep(60_000).then(() => 'timeout')]);
  const streamed = await Promise.race([sseText, sleep(5000).then(() => 'stream still open')]);
  writeFileSync(release, 'done');
  const ids = { parkedTop: parked.top, parkedMiddle: parked.middle, parkedLeaf: parked.leaf, queued: queued.id };
  active.forEach((f, i) => Object.assign(ids, { [`activeTop${i}`]: f.top, [`activeMiddle${i}`]: f.middle, [`activeLeaf${i}`]: f.leaf }));
  const atExit = await storedStatuses(dataDir, ids);
  expectEq(where, 'process exit after force', exit, { code: 0, signal: null });
  expectEq(where, 'parked family untouched by force', [atExit.parkedTop.status, atExit.parkedMiddle.status, atExit.parkedLeaf.status], ['waiting', 'waiting', 'waiting']);
  for (let i = 0; i < 2; i++) {
    expectEq(where, `interrupted leaf ${i}`, atExit[`activeLeaf${i}`], { ...atExit[`activeLeaf${i}`], status: 'failed', failure: 'RUN_INTERRUPTED_BY_STOP' });
    expectEq(where, `parents of interrupted leaf ${i} stay parked at force`, [atExit[`activeTop${i}`].status, atExit[`activeMiddle${i}`].status], ['waiting', 'waiting']);
  }
  expectEq(where, 'independent queued run stays queued', atExit.queued.status, 'queued');
  if (typeof streamed === 'string' && streamed.includes('event: run.failed')) violate(where, 'parent stream reported run.failed during force');
  await store.start();
  await eventually(async () => (await store.run(queued.id)).status === 'succeeded', 60_000, 'queued run after restart');
  await eventually(async () => (await Promise.all(active.map((f) => store.run(f.top)))).every((r) => TERMINAL.includes(r.status)), 60_000, 'interrupted families settle after restart');
  const parkedAfter = await store.run(parked.leaf);
  expectEq(where, 'parked leaf waitId kept', parkedAfter.waiting?.waitId, parkedBefore.waiting?.waitId);
  await store.call('POST', `/runs/${parked.leaf}/input`, { waitId: parkedAfter.waiting.waitId, input: 'after force' });
  await eventually(async () => (await store.run(parked.top)).status === 'succeeded', 60_000, 'parked family finishes');
  const activeAfter = [];
  for (const f of active) {
    const leaf = await store.run(f.leaf);
    const middle = await store.run(f.middle);
    const top = await store.run(f.top);
    const v = await verifyFamily(store, f, where, { childFinishes: ['failed'] });
    activeAfter.push({ leafFailure: leaf.failure, middleFailure: middle.failure && { code: middle.failure.code, resumable: middle.failure.resumable, script: middle.failure.script, childRunId: middle.failure.details?.childRunId }, topFailure: top.failure && { code: top.failure.code, resumable: top.failure.resumable }, ...v });
    expectEq(where, 'leaf failure resumable', leaf.failure?.resumable, false);
    expectEq(where, 'leaf failure script state', leaf.failure?.script?.state, 'outcome-uncertain');
    expectEq(where, 'middle failure after restart', middle.failure?.code, 'RUN_INTERRUPTED_BY_STOP');
    expectEq(where, 'middle failure resumable', middle.failure?.resumable, false);
  }
  const parkedVerified = await verifyFamily(store, parked, where, { childFinishes: ['succeeded'] });
  await sleep(1500);
  expectEq(where, 'interrupted script effects (no rerun)', lineCount(effectsFile), 2);
  results.phases.force = {
    drain: { status: drain.status, phase: drain.body?.phase },
    draining: { phase: draining.phase, activeRunIds: draining.activeRunIds.length },
    force: { status: force.status, phase: force.body?.phase, unconfirmedRunIds: force.body?.unconfirmedRunIds },
    exit,
    parentStreamAtForce: typeof streamed === 'string' ? streamed.split('\n').filter((l) => l.startsWith('event:')).slice(-6) : streamed,
    atExit,
    activeAfter,
    parkedVerified,
    queuedAfter: (await store.run(queued.id)).status,
    effects: lineCount(effectsFile),
  };
  log(where, JSON.stringify(results.phases.force));
  await store.call('POST', '/system/shutdown', { action: 'drain' });
  results.phases.force.finalExit = await store.server.exited;
}

const dirs = [];
try {
  const a = await makeDataDir('c3a');
  dirs.push(a);
  await phaseDrain(a);
  const b = await makeDataDir('c3b');
  dirs.push(b);
  await phaseForce(b);
} catch (error) {
  violate('harness', error instanceof Error ? error.stack : String(error));
} finally {
  results.violations = violations;
  results.verdict = violations.length ? 'FAIL' : 'PASS';
  writeJson('check3-nested-shutdown.json', results);
  log('verdict', results.verdict, `${violations.length} violations`);
  for (const s of live) await s.kill();
  await sleep(1000);
  for (const d of dirs) await removeDir(d);
  log('removed', dirs.map((d) => (existsSync(d) ? `${d} STILL PRESENT` : `${d} removed`)));
}
