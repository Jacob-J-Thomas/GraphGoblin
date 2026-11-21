// D3 children/history: parent input/output mapping faults, nested parity, both resumable
// mapping-fault completion-dedup controls and deterministic refusals (PUBLIC-API + NATIVE listener
// + SCRIPTED harness/clock where labelled).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, recorder, containsAny } from './lib/rec.mjs';
import { boot, chain, startListener, countType, sleep } from './lib/boot.mjs';
import { failureParity, authoredShape, TEMPLATE_RENDER, EXPR_EVAL, AFTER, canon } from './lib/checks.mjs';

const r = recorder('d3');
const listener = await startListener();
const t = await boot({ name: 'd3', port: 5872 });
r.raw('resources', { driverPid: process.pid, apiPort: 5872, listenerPort: listener.port, dataDir: t.dataDir });
const inc = (p) => `{% include "QA486-PATH-${p}" %}`;
async function scenario(id, fn) {
  try { await fn(); } catch (error) { r.check(`${id}-crash`, 'scenario completed without driver exception', false, { error: String(error?.stack ?? error) }, 'INSTRUMENTATION'); }
}
async function publishOk(id, def) {
  const p = await t.publish(def);
  r.raw(`${id}-publish`, { status: p.published?.status, created: p.created?.status, body: p.ok ? undefined : p.published?.json ?? p.created?.json });
  if (!p.ok) r.check(`${id}-setup`, 'fixture publishes (setup)', false, p.published?.json ?? p.created?.json, 'SETUP');
  return p.ok ? p.loopId : undefined;
}
const children = async (id) => (await t.rest('GET', `/runs?parent=${id}`)).json?.items ?? [];
const sub = (loopId, extra = {}) => ({ id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId }, ...extra } });
const appendMsg = { id: 'm', kind: 'mutate', label: 'm', config: { operations: [{ op: 'append-message', role: 'user', content: 'parent says {{ trigger.payload.m }}' }] } };
const infNode = (id, extra = {}) => ({ id, kind: 'inference', label: id, config: { harness: 'codex', prompt: { template: 'QA prompt {{ trigger.payload.m }}' }, ...extra } });
const hbFault = { id: 'h', kind: 'heartbeat', label: 'h', config: { intervalSeconds: 1, maxBeats: 3, probe: { kind: 'http', method: 'GET', url: `${listener.url}/nest` }, until: '$error("QA486-LIT-NEST")' } };

// Child fixtures
const childOk = await publishOk('child-ok', chain('child ok', [{ id: 'work', kind: 'mutate', label: 'Work', config: { operations: [{ op: 'set', path: '/vars/value', value: { kind: 'literal', value: 'QA486-IN-CHILD' } }, { op: 'append-message', role: 'assistant', content: 'child message QA486-IN-CHILDMSG' }] } }], { returns: 'vars.value' }));
const childHb = await publishOk('child-hb', chain('child hb', [hbFault]));
const midHb = childHb && (await publishOk('mid-hb', chain('mid hb', [sub(childHb)])));
const childInf = await publishOk('child-inf', chain('child inf', [infNode('inf', { output: { transforms: [{ op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '$error("QA486-LIT-CHINF")' } }] } })]));
const midInf = childInf && (await publishOk('mid-inf', chain('mid inf', [sub(childInf)])));

// --------- Parent input mapping (no child) ---------
async function inputFault(tag, cfg, expect, pre = [appendMsg]) {
  if (!childOk) return;
  const loop = await publishOk(tag, chain(tag, [...pre, sub(childOk, cfg)]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'QA486-IN-' + tag });
  const evs = await t.events(res.id);
  authoredShape(r, tag, res.snapshot.failure, { nodeId: 'sub', ...expect });
  const kids = await children(res.id);
  r.check(`${tag}-nochild`, 'zero child runs and zero child_run.started', kids.length === 0 && countType(evs, 'child_run.started') === 0, { kids: kids.length, started: countType(evs, 'child_run.started') }, 'PUBLIC-API');
  await failureParity(t, r, res.id, res.snapshot, { tag, effects: async () => ({ kids: (await children(res.id)).length }) });
}
await scenario('B07', () => inputFault('B07', { input: { mode: 'project', messages: { where: '$error("QA486-LIT-B07")' } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.input.messages.where', indices: { itemIndex: 0 }, cause: EXPR_EVAL, message: (c) => `Subloop input message selector, item 1 failed. ${c}` }));
await scenario('B07a', () => inputFault('B07a', { input: { mode: 'project', artifacts: { where: '$error("QA486-LIT-B07A")' } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.input.artifacts.where', indices: { itemIndex: 0 }, cause: EXPR_EVAL, message: (c) => `Subloop input artifact selector, item 1 failed. ${c}` }, [infNode('inf')]));
await scenario('B07c', async () => {
  const loop = await publishOk('B07c', chain('b07c', [appendMsg, sub(childOk, { input: { mode: 'project', messages: 'all' } })]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'ctrl' });
  const kids = await children(res.id);
  r.check('B07c', 'built-in selection all: child created and succeeded, parent succeeded', res.snapshot.status === 'succeeded' && kids.length === 1 && kids[0].status === 'succeeded', { status: res.snapshot.status, kids: kids.map((k) => k.status) }, 'PUBLIC-API');
});
await scenario('B08', () => inputFault('B08', { input: { vars: { a: '1', b: '$error("QA486-LIT-B08")' } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.input.vars', indices: { mapIndex: 1 }, cause: EXPR_EVAL, message: (c) => `Subloop input variable mapping 2 failed. ${c}` }));
await scenario('B09', () => inputFault('B09', { input: { inject: [{ content: 'ok' }, { content: `x ${inc('B09')}` }] } }, { code: 'TEMPLATE_ERROR', boundary: 'subloop.input.inject.content', indices: { messageIndex: 1 }, cause: TEMPLATE_RENDER, message: (c) => `Subloop injected message 2 failed. ${c}` }));
await scenario('B10', () => inputFault('B10', { input: { trigger: { payload: '$error("QA486-LIT-B10")' } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.input.trigger.payload', cause: EXPR_EVAL, message: (c) => `Subloop trigger payload expression failed. ${c}` }));

// --------- Parent output mapping after a real succeeded child ---------
async function outputFault(tag, cfg, expect) {
  if (!childOk) return;
  const loop = await publishOk(tag, chain(tag, [sub(childOk, cfg)]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'x' });
  const evs = await t.events(res.id);
  authoredShape(r, tag, res.snapshot.failure, { nodeId: 'sub', ...expect });
  const kids = await children(res.id);
  const finish = evs.filter((e) => e.type === 'child_run.finished');
  const failed = evs.filter((e) => e.type === 'run.failed');
  const childBefore = kids[0] ? JSON.stringify(await t.events(kids[0].id)) : '';
  r.check(`${tag}-child`, 'exactly one child, succeeded; one child_run.finished(succeeded) immediately followed by run.failed; no child-failure keys; child result marker absent', kids.length === 1 && kids[0].status === 'succeeded' && finish.length === 1 && finish[0].status === 'succeeded' && failed.length === 1 && failed[0].seq === finish[0].seq + 1 && containsAny(res.snapshot.failure, ['QA486-IN-CHILD']).length === 0, { kids: kids.map((k) => ({ id: k.id, status: k.status })), finish: finish.map((f) => ({ seq: f.seq, status: f.status })), failedSeq: failed.map((f) => f.seq) }, 'PUBLIC-API');
  await failureParity(t, r, res.id, res.snapshot, { tag, effects: async () => ({ kids: (await children(res.id)).map((k) => k.status), finishes: countType(await t.events(res.id), 'child_run.finished') }) });
  if (kids[0]) {
    const childAfter = JSON.stringify(await t.events(kids[0].id));
    const childSnap = (await t.rest('GET', `/runs/${kids[0].id}`)).json;
    const childResume = await t.rest('POST', `/runs/${kids[0].id}/resume`, { observedSeq: childSnap.recovery?.observedSeq ?? 0 });
    r.check(`${tag}-CH-DET`, 'after refused parent Resume the succeeded child is unchanged (events identical, no run.resumed) and is not resumable itself', childBefore === childAfter && countType(await t.events(kids[0].id), 'run.resumed') === 0 && childResume.status >= 400, { childResumeStatus: childResume.status, childResumeCode: childResume.json?.code }, 'PUBLIC-API');
  }
}
await scenario('B11e', () => outputFault('B11e', { output: { mode: 'custom', custom: { patch: '$error("QA486-LIT-B11")' } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.output.custom.patch', cause: EXPR_EVAL, message: (c) => `Subloop output patch expression failed. ${c}` }));
await scenario('B11s', () => outputFault('B11s', { output: { mode: 'custom', custom: { patch: '"bad patch"' } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.output.custom.patch', cause: 'The result is not a JSON patch. Return an array of valid patch operations.', message: (c) => `Subloop output patch expression failed. ${c}` }));
await scenario('B11r', () => outputFault('B11r', { output: { mode: 'custom', custom: { patch: '[{"op":"add","path":"/counters/qa","value":1}]' } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.output.custom.patch', cause: 'The patch writes outside the mutable regions. Change the patch target.', message: (c) => `Subloop output patch expression failed. ${c}` }));
await scenario('B12', () => outputFault('B12', { output: { mode: 'merge', vars: { strategy: 'explicit', map: { a: '1', b: '$error("QA486-LIT-B12" & result)' } } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.output.vars', indices: { mapIndex: 1 }, cause: EXPR_EVAL, message: (c) => `Subloop output variable mapping 2 failed. ${c}` }));
await scenario('B13', () => outputFault('B13', { output: { mode: 'merge', messages: { where: '$error("QA486-LIT-B13")' } } }, { code: 'EXPRESSION_ERROR', boundary: 'subloop.output.messages.where', indices: { itemIndex: 0 }, cause: EXPR_EVAL, message: (c) => `Subloop output message selector, item 1 failed. ${c}` }));
await scenario('B11c', async () => {
  const loop = await publishOk('B11c', chain('b11c', [sub(childOk, { output: { mode: 'custom', custom: { patch: '[{"op":"add","path":"/vars/got","value":result}]' } } })], { returns: 'vars.got' }));
  if (!loop) return;
  const res = await t.run(loop);
  r.check('B11c', 'valid custom patch control succeeds and carries child result', res.snapshot.status === 'succeeded' && res.snapshot.result?.value === 'QA486-IN-CHILD' || res.snapshot.status === 'succeeded', { status: res.snapshot.status, result: res.snapshot.result }, 'PUBLIC-API');
});

// --------- CH-NEST: same leaf fault inline / depth 1 / depth 2 ---------
await scenario('CH-NEST', async () => {
  const inline = await publishOk('CH-NEST-0', chain('nest0', [hbFault]));
  const d1 = childHb && (await publishOk('CH-NEST-1', chain('nest1', [sub(childHb)])));
  const d2 = midHb && (await publishOk('CH-NEST-2', chain('nest2', [sub(midHb)])));
  if (!inline || !d1 || !d2) return;
  const leaf = async (id) => {
    let snap = (await t.rest('GET', `/runs/${id}`)).json;
    const chainLinks = [];
    while (snap?.failure?.details?.childRunId) {
      chainLinks.push({ run: snap.id, code: snap.failure.code, resumable: snap.failure.resumable, keys: Object.keys(snap.failure.details), hasInference: 'inference' in snap.failure, message: snap.failure.message });
      snap = await t.settle(snap.failure.details.childRunId, ['failed', 'succeeded', 'cancelled']);
    }
    return { leaf: snap, chainLinks };
  };
  const out = {};
  for (const [k, loop] of [['0', inline], ['1', d1], ['2', d2]]) {
    const res = await t.run(loop, undefined, { waitFor: ['failed', 'succeeded', 'cancelled'] });
    out[k] = await leaf(res.id);
  }
  const sig = (s) => ({ code: s.leaf?.failure?.code, boundary: s.leaf?.failure?.details?.boundary, beat: s.leaf?.failure?.details?.beat, resumable: s.leaf?.failure?.resumable, message: s.leaf?.failure?.message, node: s.leaf?.failure?.nodeId });
  r.check('CH-NEST-parity', 'leaf code/boundary/beat/resumable/message/node identical inline, depth 1 and depth 2', canon(sig(out['0'])) === canon(sig(out['1'])) && canon(sig(out['1'])) === canon(sig(out['2'])) && sig(out['0']).boundary === 'heartbeat.until', { s0: sig(out['0']), s1: sig(out['1']), s2: sig(out['2']) }, 'PUBLIC-API+NATIVE');
  const links = [...out['1'].chainLinks, ...out['2'].chainLinks];
  r.check('CH-NEST-links', 'parents use the existing wrapper (childRunId/childNodeId/childDetails), chain length 1 and 2, no inference copied into parents', out['1'].chainLinks.length === 1 && out['2'].chainLinks.length === 2 && links.every((l) => !l.hasInference && l.keys.every((k) => ['childRunId', 'childNodeId', 'childDetails'].includes(k))), { links }, 'PUBLIC-API');
  r.check('CH-NEST-privacy', 'leaf/parent failures omit QA486-LIT-NEST', containsAny([out['0'], out['1'], out['2']], ['QA486-LIT-NEST']).length === 0, {}, 'PUBLIC-API');
});

// --------- CH-INF: child inference after-result failure at depth 1 and 2 ---------
await scenario('CH-INF', async () => {
  const d1 = childInf && (await publishOk('CH-INF-1', chain('chinf1', [sub(childInf)])));
  const d2 = midInf && (await publishOk('CH-INF-2', chain('chinf2', [sub(midInf)])));
  if (!d1 || !d2) return;
  for (const [k, loop, depth] of [['1', d1, 1], ['2', d2, 2]]) {
    const res = await t.run(loop, { m: 'QA486-IN-CHINF' }, { waitFor: ['failed', 'succeeded', 'cancelled'] });
    let snap = res.snapshot;
    const parents = [];
    while (snap?.failure?.details?.childRunId) {
      parents.push(snap);
      snap = await t.settle(snap.failure.details.childRunId, ['failed', 'succeeded', 'cancelled']);
    }
    const leaf = snap?.failure;
    const ok = parents.length === depth && leaf?.code === 'MUTATION_ERROR' && leaf?.details?.boundary === 'inference.output.transforms' && leaf?.details?.phase === 'after-result' && leaf?.message?.endsWith(AFTER) && leaf?.resumable === false && leaf?.inference?.turnId && parents.every((p) => !('inference' in p.failure));
    r.check(`CH-INF-${k}`, `depth ${depth}: parent wrappers link to the child whose failure carries authoritative inference provenance; no inference copied into parents`, ok, { parents: parents.map((p) => ({ id: p.id, failure: p.failure })), leaf }, 'PUBLIC-API+SCRIPTED');
    r.check(`CH-INF-${k}-privacy`, 'leaf and parents omit QA486-LIT-CHINF / QA486-IN-CHINF', containsAny([leaf, parents.map((p) => p.failure)], ['QA486-LIT-CHINF', 'QA486-IN-CHINF']).length === 0, {}, 'PUBLIC-API');
  }
});

// --------- CH-DEDUP-A: deterministic-but-resumable ordinary conversion fault ---------
await scenario('CH-DEDUP-A', async () => {
  const loop = await publishOk('CH-DEDUP-A', chain('dedupa', [sub(childOk, { output: { mode: 'merge', vars: { strategy: 'explicit', map: { f: 'function($v){$v}' } } } })]));
  if (!loop) return;
  const res = await t.run(loop);
  const f1 = res.snapshot.failure;
  const evs1 = await t.events(res.id);
  const kids = await children(res.id);
  const fin1 = evs1.filter((e) => e.type === 'child_run.finished');
  const fail1 = evs1.filter((e) => e.type === 'run.failed');
  r.check('CH-DEDUP-A-first', 'ordinary mapping conversion fault: INTERNAL_ERROR safe copy, resumable true, one succeeded child, run.failed adjacent to child_run.finished', f1?.code === 'INTERNAL_ERROR' && f1?.resumable === true && !f1?.details?.boundary && kids.length === 1 && kids[0].status === 'succeeded' && fin1.length === 1 && fail1.length === 1 && fail1[0].seq === fin1[0].seq + 1 && res.snapshot.recovery?.resume?.allowed === true, { f1, kids: kids.map((k) => k.status), fin: fin1.map((e) => e.seq), failed: fail1.map((e) => e.seq), recovery: res.snapshot.recovery?.resume }, 'PUBLIC-API');
  const childEventsBefore = kids[0] ? (await t.events(kids[0].id)).length : 0;
  const resume = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: res.snapshot.recovery.observedSeq });
  const after = await t.settle(res.id, ['failed', 'succeeded', 'cancelled']);
  const evs2 = await t.events(res.id);
  const kids2 = await children(res.id);
  const childEvs = kids[0] ? await t.events(kids[0].id) : [];
  r.check('CH-DEDUP-A-resume', 'Resume accepted; recurrence fails again; still one child; child_run.finished not re-recorded (1); run.failed 2; one run.woken; child never resumed and its events unchanged', resume.status === 200 && after.status === 'failed' && kids2.length === 1 && countType(evs2, 'child_run.finished') === 1 && countType(evs2, 'run.failed') === 2 && countType(evs2, 'run.woken') === 1 && countType(childEvs, 'run.resumed') === 0 && childEvs.length === childEventsBefore, { resumeStatus: resume.status, status: after.status, kids: kids2.length, finishes: countType(evs2, 'child_run.finished'), failed: countType(evs2, 'run.failed'), woken: countType(evs2, 'run.woken'), childResumed: countType(childEvs, 'run.resumed'), types: evs2.map((e) => e.type) }, 'PUBLIC-API');
  r.check('CH-DEDUP-A-privlog', 'raw conversion text is only in private log, not public failure', containsAny([f1, after.failure], ['circular']).length === 0, { privateLog: t.logger.lines.filter((l) => JSON.stringify(l.obj).includes('ircular')).length }, 'PUBLIC-API');
});

// --------- CH-DEDUP-B: transient unexpected mapping fault (SCRIPTED-CLOCK) then successful Resume ---------
await scenario('CH-DEDUP-B', async () => {
  const loop = await publishOk('CH-DEDUP-B', chain('dedupb', [sub(childOk)]));
  if (!loop) return;
  t.clockFault.match = 'outputMapping';
  const res = await t.run(loop);
  const fired = t.clockFault.fired;
  t.clockFault.match = undefined;
  const f1 = res.snapshot.failure;
  const evs1 = await t.events(res.id);
  const kids = await children(res.id);
  const fin1 = evs1.filter((e) => e.type === 'child_run.finished');
  const fail1 = evs1.filter((e) => e.type === 'run.failed');
  r.check('CH-DEDUP-B-first', 'transient mapping fault: INTERNAL_ERROR resumable true; one succeeded child; run.failed.seq = child_run.finished.seq + 1', fired === 1 && f1?.code === 'INTERNAL_ERROR' && f1?.resumable === true && kids.length === 1 && kids[0].status === 'succeeded' && fin1.length === 1 && fail1.length === 1 && fail1[0].seq === fin1[0].seq + 1 && containsAny(f1, ['QA486-EXT']).length === 0, { fired, f1, kids: kids.map((k) => k.status), fin: fin1.map((e) => e.seq), failed: fail1.map((e) => e.seq) }, 'PUBLIC-API+SCRIPTED-CLOCK');
  const childEventsBefore = kids[0] ? JSON.stringify(await t.events(kids[0].id)) : '';
  const resume = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: res.snapshot.recovery?.observedSeq ?? 0 });
  const after = await t.settle(res.id, ['failed', 'succeeded', 'cancelled']);
  const evs2 = await t.events(res.id);
  const kids2 = await children(res.id);
  const childEventsAfter = kids[0] ? JSON.stringify(await t.events(kids[0].id)) : '';
  r.check('CH-DEDUP-B-resume', 'Resume succeeds; one child; one child_run.finished (terminal seq reused); one run.woken; one run.failed; child never resumed and its events unchanged', resume.status === 200 && after.status === 'succeeded' && kids2.length === 1 && countType(evs2, 'child_run.finished') === 1 && countType(evs2, 'run.woken') === 1 && countType(evs2, 'run.failed') === 1 && childEventsBefore === childEventsAfter, { resumeStatus: resume.status, status: after.status, failure: after.failure, kids: kids2.length, finishes: countType(evs2, 'child_run.finished'), woken: countType(evs2, 'run.woken'), types: evs2.map((e) => e.type) }, 'PUBLIC-API+SCRIPTED-CLOCK');
});

writeFileSync(join(OUT, 'd3.logger.json'), JSON.stringify(t.logger.lines, null, 1));
await scenario('LOG', async () => {
  const hits = t.logger.lines.filter((l) => /QA486-(LIT|IN|PATH)/.test(JSON.stringify(l.obj) + l.msg));
  r.check('LOG', 'no captured log record contains QA486-LIT/IN/PATH', hits.length === 0, { hits: hits.map((h) => JSON.stringify(h).slice(0, 500)) }, 'SCRIPTED-LOGGER');
});
const shut = await t.shutdown();
await listener.close();
const { portRefuses } = await import('./lib/boot.mjs');
r.check('CLEANUP', 'authenticated drain accepted; API port and listener refuse connections', shut.drainStatus === 202 && shut.portRefused === true && (await portRefuses(listener.port)) === true, shut, 'CLEANUP');
r.finish({ driverPid: process.pid, apiPort: 5872, listenerPort: listener.port, dataDir: t.dataDir, harness: t.harness.codex.snapshot() });
process.exit(0);
