// Check 4: webhook return delivery and finalization, retries with one identity, SSE completion
// only after finalizedAt, a kill during an in-flight attempt, and a child run with its own delivery.
// Run: node --expose-gc check4-delivery.mjs
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import {
  apiStore, chain, countType, eventually, exitNode, logger, makeDataDir, removeDir, sleep, subNode,
  TERMINAL, writeJson,
} from './lib.mjs';

const log = logger('check4-delivery');
const PORT = Number(process.env.QA_PORT ?? 6390);
const HOOK_PORT = Number(process.env.QA_HOOK_PORT ?? 6391);
const violations = [];
const results = { phases: {} };
const violate = (where, what, extra) => {
  violations.push({ where, what, ...(extra ? { extra } : {}) });
  log('VIOLATION', where, what, extra ?? '');
};
const expectEq = (where, label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) violate(where, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

// Receiver: per path a script of responses: number = status, 'hang' = never answer.
const plans = new Map();
const received = [];
const hanging = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const plan = plans.get(req.url) ?? [];
    const step = plan.length ? plan.shift() : 200;
    received.push({ at: Date.now(), path: req.url, key: req.headers['idempotency-key'], step, body: body.slice(0, 300) });
    if (step === 'hang') {
      hanging.push(res);
      return;
    }
    res.writeHead(step, { 'content-type': 'application/json' }).end('{}');
  });
});
await new Promise((r) => receiver.listen(HOOK_PORT, '127.0.0.1', r));
const hookUrl = (path) => `http://127.0.0.1:${HOOK_PORT}${path}`;

/** Follow SSE from after=0 and timestamp every frame; resolves at stream.complete or EOF. */
function follow(store, runId) {
  const frames = [];
  const controller = new AbortController();
  const done = (async () => {
    const response = await fetch(`${store.origin}/runs/${runId}/events?after=0`, { headers: { accept: 'text/event-stream' }, signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done: eof } = await reader.read();
      if (eof) {
        frames.push({ at: Date.now(), event: 'EOF' });
        return frames;
      }
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = /^event: (.*)$/m.exec(raw)?.[1];
        if (!event) continue;
        frames.push({ at: Date.now(), event, id: /^id: (.*)$/m.exec(raw)?.[1] });
        if (event === 'stream.complete') {
          controller.abort();
          return frames;
        }
      }
    }
  })().catch((error) => {
    if (error.name === 'AbortError') return frames;
    frames.push({ at: Date.now(), event: `ERROR ${error.message}` });
    return frames;
  });
  return { frames, done, abort: () => controller.abort() };
}

/** Poll the run until finalized, keeping the moment execution ended and the moment finalization did. */
async function watchFinalization(store, runId) {
  let terminalAt;
  let terminalUnfinalizedSeen = false;
  const final = await eventually(async () => {
    const run = await store.run(runId);
    if (TERMINAL.includes(run.status) && !terminalAt) terminalAt = Date.now();
    if (TERMINAL.includes(run.status) && !run.finalizedAt) terminalUnfinalizedSeen = true;
    return run.finalizedAt ? run : false;
  }, 90_000, 'finalized');
  return { final, terminalAt, finalizedSeenAt: Date.now(), terminalUnfinalizedSeen };
}

function deliveryFacts(events) {
  return {
    queued: countType(events, 'delivery.queued'),
    attempted: countType(events, 'delivery.attempted'),
    attemptFinished: countType(events, 'delivery.attempt_finished'),
    finished: events.filter((e) => e.type === 'delivery.finished').map((e) => ({ status: e.delivery.status, id: e.delivery.id, attempts: e.delivery.attempts, acknowledgementUncertain: e.delivery.acknowledgementUncertain, effectMayHaveHappened: e.delivery.effectMayHaveHappened })),
    deliveryIds: [...new Set(events.filter((e) => e.type.startsWith('delivery.')).map((e) => e.delivery?.id).filter(Boolean))],
  };
}

async function phaseRetry(store) {
  const where = '4A retry with one identity; stream completes after finalizedAt';
  plans.set('/hook-a', [503, 200]);
  const loop = await store.publish(chain('QA delivery retry', [exitNode('{"v": 1}', { destinations: [{ kind: 'webhook', url: hookUrl('/hook-a') }] })]));
  const run = await store.startRun(loop);
  const stream = follow(store, run.id);
  const watch = await watchFinalization(store, run.id);
  const frames = await Promise.race([stream.done, sleep(15_000).then(() => 'no completion')]);
  const completeFrame = Array.isArray(frames) ? frames.find((f) => f.event === 'stream.complete') : undefined;
  const runAtComplete = await store.run(run.id);
  const events = await store.events(run.id);
  const hits = received.filter((r) => r.path === '/hook-a');
  const facts = deliveryFacts(events);
  expectEq(where, 'receiver requests', hits.map((h) => h.step), [503, 200]);
  expectEq(where, 'one Idempotency-Key across attempts', new Set(hits.map((h) => h.key)).size, 1);
  expectEq(where, 'delivery.finished once', facts.finished.length, 1);
  expectEq(where, 'delivery identities', facts.deliveryIds.length, 1);
  expectEq(where, 'run.deliveries', runAtComplete.deliveries?.map((d) => d.status), ['delivered']);
  if (!completeFrame) violate(where, 'no stream.complete', frames);
  else if (completeFrame.at < hits.at(-1).at) violate(where, 'stream completed before the successful delivery');
  if (!watch.terminalUnfinalizedSeen) violate(where, 'never observed terminal-but-unfinalized (delivery window)');
  const terminalFrame = Array.isArray(frames) ? frames.find((f) => ['run.finished', 'run.failed'].includes(f.event)) : undefined;
  results.phases.retry = {
    runId: run.id,
    hits: hits.map((h) => ({ step: h.step, key: h.key, at: h.at })),
    facts,
    deliveries: runAtComplete.deliveries,
    finalizedAt: runAtComplete.finalizedAt,
    timeline: {
      terminalFrameAt: terminalFrame?.at,
      lastRequestAt: hits.at(-1)?.at,
      streamCompleteAt: completeFrame?.at,
      finalizedSeenBy: watch.finalizedSeenAt,
      terminalUnfinalizedObserved: watch.terminalUnfinalizedSeen,
    },
    frameTail: Array.isArray(frames) ? frames.slice(-6).map((f) => f.event) : frames,
  };
  log(where, JSON.stringify(results.phases.retry));
}

async function phaseKillInFlight(store) {
  const where = '4B kill during an in-flight attempt; recovery keeps identity';
  plans.set('/hook-b', ['hang', 200]);
  const loop = await store.publish(chain('QA delivery kill', [exitNode('{"v": 2}', { destinations: [{ kind: 'webhook', url: hookUrl('/hook-b') }] })]));
  const run = await store.startRun(loop);
  await eventually(() => received.some((r) => r.path === '/hook-b'), 30_000, 'first attempt in flight');
  const before = await store.run(run.id);
  await store.kill();
  for (const res of hanging.splice(0)) res.destroy();
  await store.start();
  const stream = follow(store, run.id);
  const watch = await watchFinalization(store, run.id);
  const frames = await Promise.race([stream.done, sleep(15_000).then(() => 'no completion')]);
  const after = await store.run(run.id);
  const events = await store.events(run.id);
  const hits = received.filter((r) => r.path === '/hook-b');
  const facts = deliveryFacts(events);
  expectEq(where, 'status at kill', before.status, 'succeeded');
  expectEq(where, 'finalized at kill', Boolean(before.finalizedAt), false);
  expectEq(where, 'receiver requests', hits.map((h) => h.step), ['hang', 200]);
  expectEq(where, 'one Idempotency-Key across the kill', new Set(hits.map((h) => h.key)).size, 1);
  expectEq(where, 'delivery.finished once', facts.finished.length, 1);
  expectEq(where, 'status unchanged', after.status, 'succeeded');
  const completeFrame = Array.isArray(frames) ? frames.find((f) => f.event === 'stream.complete') : undefined;
  if (!completeFrame) violate(where, 'no stream.complete after restart', frames);
  results.phases.killInFlight = {
    runId: run.id,
    atKill: { status: before.status, finalizedAt: before.finalizedAt ?? null, deliveries: before.deliveries },
    hits: hits.map((h) => ({ step: h.step, key: h.key })),
    facts,
    deliveries: after.deliveries,
    finalizedAt: after.finalizedAt,
    streamCompleteAfterFinalized: completeFrame ? completeFrame.at >= hits.at(-1).at : false,
    watch: { terminalUnfinalizedObserved: watch.terminalUnfinalizedSeen },
  };
  log(where, JSON.stringify(results.phases.killInFlight));
}

async function phaseChild(store) {
  const where = '4C child run with its own delivery, kill during its retry backoff';
  plans.set('/hook-child', [503, 200]);
  plans.set('/hook-parent', [200]);
  const child = await store.publish(chain('QA delivery child', [exitNode('{"child": true}', { destinations: [{ kind: 'caller' }, { kind: 'webhook', url: hookUrl('/hook-child') }] })]));
  const parent = await store.publish(chain('QA delivery parent', [subNode(child), exitNode('{"parent": outputs.sub.value.result}', { destinations: [{ kind: 'webhook', url: hookUrl('/hook-parent') }] })]));
  const run = await store.startRun(parent);
  const stream = follow(store, run.id);
  // The child's first attempt fails; kill inside the 2-second backoff before the second.
  await eventually(() => received.some((r) => r.path === '/hook-child'), 30_000, 'child first attempt');
  await sleep(500);
  const [kid] = await store.children(run.id);
  const atKill = { parent: await store.run(run.id), child: await store.run(kid.id) };
  await store.kill();
  const streamAtKill = await Promise.race([stream.done, sleep(2000).then(() => 'open')]);
  await store.start();
  const stream2 = follow(store, run.id);
  const watchParent = await watchFinalization(store, run.id);
  const childFinal = await store.run(kid.id);
  const frames2 = await Promise.race([stream2.done, sleep(15_000).then(() => 'no completion')]);
  const parentEvents = await store.events(run.id);
  const childEvents = await store.events(kid.id);
  const childHits = received.filter((r) => r.path === '/hook-child');
  const parentHits = received.filter((r) => r.path === '/hook-parent');
  expectEq(where, 'child receiver requests', childHits.map((h) => h.step), [503, 200]);
  expectEq(where, 'child one identity', new Set(childHits.map((h) => h.key)).size, 1);
  expectEq(where, 'parent receiver requests', parentHits.map((h) => h.step), [200]);
  expectEq(where, 'child delivery.finished once', deliveryFacts(childEvents).finished.length, 1);
  expectEq(where, 'parent delivery.finished once', deliveryFacts(parentEvents).finished.length, 1);
  expectEq(where, 'parent child_run.started', countType(parentEvents, 'child_run.started'), 1);
  expectEq(where, 'parent child_run.finished', countType(parentEvents, 'child_run.finished'), 1);
  expectEq(where, 'parent node.finished(sub)', countType(parentEvents, 'node.finished', (e) => e.nodeId === 'sub'), 1);
  expectEq(where, 'parent run.finished', countType(parentEvents, 'run.finished'), 1);
  expectEq(where, 'parent result', watchParent.final.result, { parent: { child: true } });
  if (!childFinal.finalizedAt) violate(where, 'child not finalized');
  const complete = Array.isArray(frames2) ? frames2.find((f) => f.event === 'stream.complete') : undefined;
  if (!complete) violate(where, 'parent stream not completed', frames2);
  else if (complete.at < parentHits.at(-1).at) violate(where, 'parent stream completed before its delivery');
  results.phases.child = {
    parent: run.id,
    child: kid.id,
    atKill: {
      parent: { status: atKill.parent.status, waiting: atKill.parent.waiting?.kind },
      child: { status: atKill.child.status, finalizedAt: atKill.child.finalizedAt ?? null, deliveries: atKill.child.deliveries },
    },
    parentStreamAtKill: Array.isArray(streamAtKill) ? streamAtKill.slice(-3).map((f) => f.event) : streamAtKill,
    childHits: childHits.map((h) => ({ step: h.step, key: h.key })),
    parentHits: parentHits.map((h) => ({ step: h.step, key: h.key })),
    childDeliveries: childFinal.deliveries,
    parentDeliveries: watchParent.final.deliveries,
    childWakeVsDelivery: {
      childDeliveredAt: childHits.at(-1)?.at,
      parentFinishedEventTs: parentEvents.find((e) => e.type === 'run.finished')?.ts,
      childFinishedEventTs: childEvents.find((e) => e.type === 'run.finished')?.ts,
    },
    parentFinalizedAt: watchParent.final.finalizedAt,
    childFinalizedAt: childFinal.finalizedAt,
  };
  log(where, JSON.stringify(results.phases.child));
}

const dirs = [];
let store;
try {
  const dir = await makeDataDir('c4');
  dirs.push(dir);
  store = apiStore({ dataDir: dir, port: PORT, log });
  await store.start();
  await phaseRetry(store);
  await phaseKillInFlight(store);
  await phaseChild(store);
} catch (error) {
  violate('harness', error instanceof Error ? error.stack : String(error));
} finally {
  await store?.kill();
  receiver.closeAllConnections?.();
  receiver.close();
  results.violations = violations;
  results.verdict = violations.length ? 'FAIL' : 'PASS';
  results.allRequests = received.map((r) => ({ path: r.path, step: r.step, key: r.key }));
  writeJson('check4-delivery.json', results);
  log('verdict', results.verdict, `${violations.length} violations`);
  for (const d of dirs) await removeDir(d);
  log('removed', dirs.map((d) => (existsSync(d) ? `${d} STILL PRESENT` : `${d} removed`)));
}
