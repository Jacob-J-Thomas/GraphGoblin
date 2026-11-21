// D4 inference boundaries and recovery (PUBLIC-API + SQLITE + NATIVE context files; harness,
// storage and catalog-fault mechanics are SCRIPTED and counted separately).
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, WORK, recorder, containsAny } from './lib/rec.mjs';
import { boot, chain, countType, sleep, domain, portRefuses } from './lib/boot.mjs';
import { failureParity, authoredShape, TEMPLATE_RENDER, EXPR_EVAL, AFTER, canon } from './lib/checks.mjs';

const r = recorder('d4');
let t = await boot({ name: 'd4', port: 5873 });
const H = () => t.harness.codex;
r.raw('resources', { driverPid: process.pid, apiPort: 5873, dataDir: t.dataDir });
const inc = (p) => `{% include "QA486-PATH-${p}" %}`;
const MODEL = 'gpt-6-luna';
async function scenario(id, fn) {
  try { await fn(); } catch (error) { r.check(`${id}-crash`, 'scenario completed without driver exception', false, { error: String(error?.stack ?? error) }, 'INSTRUMENTATION'); }
}
async function publishOk(id, def) {
  const p = await t.publish(def);
  r.raw(`${id}-publish`, { status: p.published?.status, created: p.created?.status, body: p.ok ? undefined : p.published?.json ?? p.created?.json });
  if (!p.ok) r.check(`${id}-setup`, 'fixture publishes (setup)', false, p.published?.json ?? p.created?.json, 'SETUP');
  return p.ok ? p.loopId : undefined;
}
const inf = (extra = {}) => ({ id: 'inf', kind: 'inference', label: 'Inf', config: { harness: 'codex', prompt: { template: 'QA prompt {{ trigger.payload.m }}' }, ...extra } });
const msg = { id: 'm', kind: 'mutate', label: 'm', config: { operations: [{ op: 'append-message', role: 'user', content: 'u1' }, { op: 'append-message', role: 'user', content: 'u2' }] } };
const wsRoot = join(WORK, 'ws');
mkdirSync(wsRoot, { recursive: true });
const fixedWs = (name) => { const p = join(wsRoot, name); return { settings: { workingDirectory: { kind: 'fixed', path: p } }, path: p }; };
const turns = (evs) => evs.filter((e) => e.type === 'harness.turn');
const catalog = (enabled) => t.rest('PATCH', `/model-catalog/codex/${MODEL}`, { enabled });
const failedSeq = (evs) => evs.filter((e) => e.type === 'run.failed').at(-1)?.seq;
// Attempt-2: synchronous multi-shot via boot eventFault.times (attempt-1 timer re-arm never ran).
const setFault = (pred, times, afterCommit) => { t.eventFault.afterCommit = afterCommit; t.eventFault.times = times; t.eventFault.match = pred; };

async function authoredInf(tag, def, expect, { input = { m: 'QA486-IN-' + tag }, starts = 0, harnessTurns = 0 } = {}) {
  const loop = await publishOk(tag, def);
  if (!loop) return;
  const s0 = H().snapshot();
  const res = await t.run(loop, input);
  const evs = await t.events(res.id);
  authoredShape(r, tag, res.snapshot.failure, { nodeId: 'inf', ...expect }, 'PUBLIC-API+SCRIPTED');
  const s1 = H().snapshot();
  r.check(`${tag}-harness`, `SCRIPTED harness starts +${starts}, resumes +0, harness.turn events ${harnessTurns}`, s1.starts - s0.starts === starts && s1.resumes === s0.resumes && turns(evs).length === harnessTurns, { starts: s1.starts - s0.starts, resumes: s1.resumes - s0.resumes, turns: turns(evs).length }, 'SCRIPTED');
  await failureParity(t, r, res.id, res.snapshot, { tag, effects: async () => ({ starts: H().counters.starts, resumes: H().counters.resumes }) });
  return { res, evs };
}

// ---------------- B14 input transforms ----------------
await scenario('B14', () => authoredInf('B14', chain('b14', [inf({ input: [{ op: 'set', path: '/vars/ok', value: { kind: 'literal', value: 1 } }, { op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '$error("QA486-LIT-B14")' } }] })]), { code: 'MUTATION_ERROR', boundary: 'inference.input', indices: { operationIndex: 1, operationKind: 'set' }, cause: EXPR_EVAL, message: (c) => `Inference input transform 2 (set) failed. ${c}` }));
const b14m = [
  ['B14-append', { op: 'append-message', role: 'note', content: `x ${inc('B14A')}` }, 'append-message', TEMPLATE_RENDER, undefined],
  ['B14-truncate', { op: 'truncate', keep: { last: 1 }, where: '$error("QA486-LIT-B14T")' }, 'truncate', EXPR_EVAL, 0],
  ['B14-drop', { op: 'drop', target: 'messages', where: '$error("QA486-LIT-B14D")' }, 'drop', EXPR_EVAL, 0],
  ['B14-replace', { op: 'replace', target: 'messages', where: '$error("QA486-LIT-B14R")', pattern: 'u', replacement: 'v' }, 'replace', EXPR_EVAL, 0],
  ['B14-setT', { op: 'set', path: '/vars/y', value: { kind: 'template', template: inc('B14S') } }, 'set', TEMPLATE_RENDER, undefined],
];
for (const [tag, op, kind, cause, item] of b14m)
  await scenario(tag, () => authoredInf(tag, chain(tag, [msg, inf({ input: [op] })]), { code: 'MUTATION_ERROR', boundary: 'inference.input', indices: { operationIndex: 0, operationKind: kind, ...(item !== undefined ? { itemIndex: item } : {}) }, cause, message: (c) => `Inference input transform 1 (${kind})${item !== undefined ? `, item ${item + 1}` : ''} failed. ${c}` }));
await scenario('B14-regex', async () => {
  const p = await t.publish(chain('b14 regex', [msg, inf({ input: [{ op: 'replace', target: 'messages', pattern: '(', replacement: 'v' }] })]));
  if (!p.ok) { r.check('B14-regex', 'invalid regex pattern refused at publish (runtime regex cause unreachable publicly) -> recorded', true, { status: p.published?.status, body: p.published?.json }, 'PUBLIC-API'); return; }
  const res = await t.run(p.loopId, { m: 'x' });
  authoredShape(r, 'B14-regex', res.snapshot.failure, { nodeId: 'inf', code: 'MUTATION_ERROR', boundary: 'inference.input', indices: { operationIndex: 0, operationKind: 'replace' }, cause: 'The regular expression is invalid or unsafe. Check the pattern and flags.', message: (c) => `Inference input transform 1 (replace) failed. ${c}` });
});

// ---------------- B15 context files (NATIVE fs) ----------------
await scenario('B15', async () => {
  const ws = fixedWs('b15');
  const out = await authoredInf('B15', chain('b15', [inf({ contextFiles: [{ path: 'a.txt', template: 'A-{{ trigger.payload.v }}' }, { path: 'b.txt', template: inc('B15') }, { path: 'c.txt', template: 'C' }] })], undefined, ws.settings), { code: 'TEMPLATE_ERROR', boundary: 'inference.contextFiles.template', indices: { fileIndex: 1 }, cause: TEMPLATE_RENDER, message: (c) => `Inference context file template 2 failed. ${c}` }, { input: { v: 'ctx-ok', m: 'x' } });
  if (!out) return;
  const a = join(ws.path, 'a.txt');
  r.check('B15-native', 'first context file written byte-exact; failing and later files absent', existsSync(a) && readFileSync(a, 'utf8') === 'A-ctx-ok' && !existsSync(join(ws.path, 'b.txt')) && !existsSync(join(ws.path, 'c.txt')), { a: existsSync(a) && readFileSync(a, 'utf8'), b: existsSync(join(ws.path, 'b.txt')), c: existsSync(join(ws.path, 'c.txt')) }, 'NATIVE');
});
await scenario('B16', () => authoredInf('B16', chain('b16', [inf({ prompt: { template: `Hi ${inc('B16')}` } })]), { code: 'TEMPLATE_ERROR', boundary: 'inference.prompt.template', cause: TEMPLATE_RENDER, message: (c) => `Inference prompt template failed. ${c}` }));

// ---------------- B18 / B19 after-result ----------------
const schema = { type: 'object', required: ['x'], properties: { x: { type: 'string' } } };
await scenario('B18', async () => {
  H().reset(); H().script({ kind: 'ok', finalText: 'not-json QA486-HAR-B18' });
  const out = await authoredInf('B18', chain('b18', [inf({ output: { schema: { jsonSchema: schema, native: false, repair: { enabled: true, maxAttempts: 1, prompt: `Fix ${inc('B18')}` } } } })]), { code: 'TEMPLATE_ERROR', boundary: 'inference.output.schema.repair.prompt', indices: { attempt: 1 }, phase: 'after-result', cause: TEMPLATE_RENDER, message: (c) => `Inference schema repair prompt, attempt 1 failed. ${c}${AFTER}` }, { starts: 1, harnessTurns: 1 });
  if (out) r.check('B18-inference', 'failure.inference names the last actual (authored) turn; no repair turn; no uncertainty suffix', out.res.snapshot.failure?.inference?.turnId === turns(out.evs)[0]?.turnId && out.res.snapshot.failure?.inference?.promptKind === 'authored' && !/usable/i.test(out.res.snapshot.failure?.message), { inference: out.res.snapshot.failure?.inference }, 'PUBLIC-API');
});
const b19Transform = { output: { transforms: [{ op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '$error("QA486-LIT-B19" & lastOutput.value)' } }] } };
const b19Expect = { code: 'MUTATION_ERROR', boundary: 'inference.output.transforms', indices: { operationIndex: 0, operationKind: 'set' }, phase: 'after-result', cause: EXPR_EVAL, message: (c) => `Inference output transform 1 (set) failed. ${c}${AFTER}` };
await scenario('B19', async () => {
  H().reset(); H().script({ kind: 'ok', finalText: '"QA486-HAR-B19 provider text"' });
  const out = await authoredInf('B19', chain('b19', [inf(b19Transform)]), b19Expect, { starts: 1, harnessTurns: 1 });
  if (out) r.check('B19-inference', 'failure.inference = the actual turn (turnId/visitId/kind/session); provider text absent from the new cause', out.res.snapshot.failure?.inference?.turnId === turns(out.evs)[0]?.turnId && out.res.snapshot.failure?.inference?.sessionId && containsAny(out.res.snapshot.failure, ['QA486-HAR-B19']).length === 0, { inference: out.res.snapshot.failure?.inference }, 'PUBLIC-API');
});
await scenario('B19-ns', async () => {
  H().reset(); H().script({ kind: 'ok', session: false, accepted: false, finalText: '"x"' });
  const out = await authoredInf('B19-ns', chain('b19ns', [inf(b19Transform)]), b19Expect, { starts: 1, harnessTurns: 1 });
  if (out) r.check('B19-ns-sub', 'no session/acceptance: submission delivery-uncertain, no sessionId, no unusable-session suffix, resumable false', out.res.snapshot.failure?.inference?.submission === 'delivery-uncertain' && !out.res.snapshot.failure?.inference?.sessionId && !/usable/i.test(out.res.snapshot.failure?.message) && out.res.snapshot.failure?.resumable === false, { failure: out.res.snapshot.failure }, 'PUBLIC-API+SCRIPTED');
});
await scenario('B19-art', async () => {
  H().reset(); H().script({ kind: 'ok', finalText: 'not-json' });
  const loop = await publishOk('B19-art', chain('b19art', [inf({ output: { schema: { jsonSchema: schema, native: false, repair: { enabled: false } } } })]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'x' });
  const f = res.snapshot.failure;
  r.check('B19-art', 'schema mismatch with repair disabled keeps OUTPUT_SCHEMA_MISMATCH, no phase/received sentence', f?.code === 'OUTPUT_SCHEMA_MISMATCH' && !f?.details?.phase && !f?.message?.includes('received the provider result'), { failure: f }, 'PUBLIC-API+SCRIPTED');
});
await scenario('B19c', async () => {
  H().reset();
  const loop = await publishOk('B19c', chain('b19c', [inf({ output: { transforms: [{ op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '"ok-" & lastOutput.value' } }] } })], { returns: 'vars.x' }));
  if (!loop) return;
  const res = await t.run(loop, { m: 'x' });
  r.check('B19c', 'valid output transform control succeeds', res.snapshot.status === 'succeeded', { status: res.snapshot.status, result: res.snapshot.result, failure: res.snapshot.failure }, 'PUBLIC-API+SCRIPTED');
});

// ---------------- Stronger outcomes against B19 ----------------
await scenario('TERM', async () => {
  H().reset(); H().script({ kind: 'ok', finalText: '"x"', cancelError: Object.assign(new Error('QA486-HAR-TERM cleanup'), { code: 'HARNESS_TERMINATION_UNCONFIRMED' }) });
  const loop = await publishOk('TERM', chain('term', [inf(b19Transform)]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'x' });
  const f = res.snapshot.failure;
  r.check('TERM', 'termination-unconfirmed cleanup evidence wins over B19: own code, no after-result phase/sentence, resumable false', f?.code === 'HARNESS_TERMINATION_UNCONFIRMED' && !f?.details?.phase && !f?.message?.includes('received the provider result') && f?.resumable === false, { failure: f, cancels: H().counters.cancels }, 'SCRIPTED');
});
await scenario('WEAK', async () => {
  H().reset(); H().script({ kind: 'ok', finalText: '"x"', cancelError: Object.assign(new Error('QA486-HAR-WEAK cleanup'), { code: 'QA_WEAK' }) });
  const loop = await publishOk('WEAK', chain('weak', [inf(b19Transform)]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'x' });
  const f = res.snapshot.failure;
  const logged = t.logger.lines.some((l) => l.msg === 'harness cleanup failed');
  r.check('WEAK', 'weak generic cleanup failure is secondary: B19 authored cause wins, cleanup text not appended, cleanup logged privately', f?.code === 'MUTATION_ERROR' && f?.details?.boundary === 'inference.output.transforms' && !f?.message?.includes('QA486-HAR-WEAK') && logged, { failure: f, logged }, 'SCRIPTED');
});
await scenario('STRONG-cancel', async () => {
  H().reset(); H().script({ kind: 'hold', finalText: '"x"' });
  const loop = await publishOk('STRONG', chain('strong', [inf(b19Transform)]));
  if (!loop) return;
  const started = await t.rest('POST', `/loops/${loop}/runs`, { input: { m: 'x' } });
  const id = started.json.run.id;
  for (let i = 0; i < 100 && !H().held.length; i++) await sleep(50);
  const cancel = await t.rest('POST', `/runs/${id}/cancel`, {});
  const snap = await t.settle(id, ['cancelled', 'failed', 'succeeded']);
  H().held.forEach((h) => h.release());
  const evs = await t.events(id);
  r.check('STRONG-cancel', 'explicit cancel during held provider result wins: cancelled, no run.failed, no after-result failure', cancel.status === 200 && snap.status === 'cancelled' && countType(evs, 'run.failed') === 0, { cancel: cancel.status, status: snap.status, types: evs.map((e) => e.type) }, 'SCRIPTED');
});
await scenario('STRONG-timeout', async () => {
  H().reset(); H().script({ kind: 'hold', finalText: '"x"' });
  const loop = await publishOk('STRONG-t', chain('strongt', [inf({ ...b19Transform, timeoutSeconds: 1 })]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'x' }, { waitFor: ['failed', 'cancelled', 'succeeded'] });
  H().held.forEach((h) => h.release());
  const f = res.snapshot.failure;
  r.check('STRONG-timeout', 'node timeout wins over B19: existing timeout code, no after-result phase', /TIMEOUT/.test(f?.code ?? '') && !f?.details?.phase, { failure: f }, 'SCRIPTED');
});

// ---------------- Harness callback matrix (D / Q) ----------------
const hdErrors = [
  ['plain', () => Object.assign(new Error('QA486-HAR-D1 adapter text'), { code: 'QA_ADAPTER' })],
  ['domain', () => new domain.TemplateError('QA486-HAR-D2 domain lookalike')],
  ['name', () => Object.assign(new Error('QA486-HAR-D3 name spoof'), { name: 'TemplateError' })],
];
for (const [k, make] of hdErrors) {
  await scenario(`H-D-${k}`, async () => {
    H().reset(); H().script({ kind: 'throwSync', error: make() });
    const loop = await publishOk(`H-D-${k}`, chain(`hd ${k}`, [inf()]));
    if (!loop) return;
    const res = await t.run(loop, { m: `hd-${k}` });
    const f = res.snapshot.failure;
    const evs = await t.events(res.id);
    const t1 = turns(evs);
    r.check(`H-D-${k}`, 'sync start throw before handle: HARNESS_TURN_FAILED, definitely-not-submitted, adapter text public (established), resumable true, no authored boundary', f?.code === 'HARNESS_TURN_FAILED' && f?.inference?.submission === 'definitely-not-submitted' && f?.message?.includes('QA486-HAR-D') && f?.resumable === true && !f?.details?.boundary && t1.length === 1, { failure: f, turns: t1.length }, 'SCRIPTED');
    const s0 = H().snapshot();
    const resume = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: res.snapshot.recovery?.observedSeq ?? 0 });
    const done = await t.settle(res.id, ['succeeded', 'failed']);
    const evs2 = await t.events(res.id);
    const t2 = turns(evs2);
    const call = H().calls.at(-1);
    r.check(`H-D-${k}-resume`, 'Resume submits the exact stored prompt with the same turnId via start (no resume), succeeds', resume.status === 200 && done.status === 'succeeded' && H().counters.starts - s0.starts === 1 && H().counters.resumes === s0.resumes && call?.prompt === t1[0].prompt && t2.length === 2 && t2[1].turnId === t1[0].turnId, { resume: resume.status, status: done.status, prompt: call?.prompt, stored: t1[0]?.prompt, turnIds: t2.map((x) => x.turnId) }, 'SCRIPTED');
  });
}
await scenario('H-Q', async () => {
  H().reset(); H().script({ kind: 'rejectAfterHandle', session: true, accepted: true, error: Object.assign(new Error('QA486-HAR-Q after handle'), { code: 'QA_Q' }) });
  const loop = await publishOk('H-Q', chain('hq', [inf()]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'hq' });
  const f = res.snapshot.failure;
  r.check('H-Q', 'after-handle rejection with usable accepted session: HARNESS_DELIVERY_UNCERTAIN, resumable true (H&&U), raw adapter text public', f?.code === 'HARNESS_DELIVERY_UNCERTAIN' && f?.resumable === true && f?.inference?.sessionId && f?.message?.includes('QA486-HAR-Q'), { failure: f }, 'SCRIPTED');
  const s0 = H().snapshot();
  const resume = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: res.snapshot.recovery?.observedSeq ?? 0 });
  const done = await t.settle(res.id, ['succeeded', 'failed']);
  const call = H().calls.at(-1);
  r.check('H-Q-resume', 'Resume continues the usable session (harness.resume with that session id), no new start, succeeds', resume.status === 200 && done.status === 'succeeded' && H().counters.resumes - s0.resumes === 1 && H().counters.starts === s0.starts && call?.resumeId === f?.inference?.sessionId, { resume: resume.status, status: done.status, call }, 'SCRIPTED');
});
await scenario('H-Qn', async () => {
  H().reset(); H().script({ kind: 'rejectAfterHandle', session: false, accepted: false, error: Object.assign(new Error('QA486-HAR-QN after handle'), { code: 'QA_QN' }) });
  const loop = await publishOk('H-Qn', chain('hqn', [inf()]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'hqn' });
  const f = res.snapshot.failure;
  r.check('H-Qn', 'after-handle rejection without usable session: HARNESS_DELIVERY_UNCERTAIN, resumable false, existing uncertainty suffix present', f?.code === 'HARNESS_DELIVERY_UNCERTAIN' && f?.resumable === false && f?.inference?.submission === 'delivery-uncertain' && f?.message?.length > 'QA486-HAR-QN after handle'.length + 20, { failure: f }, 'SCRIPTED');
  const s0 = H().snapshot();
  const resume = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: res.snapshot.recovery?.observedSeq ?? 0 });
  r.check('H-Qn-refused', 'Resume refused; zero harness calls', resume.status === 409 && H().counters.starts === s0.starts && H().counters.resumes === s0.resumes, { resume: resume.status, code: resume.json?.code }, 'SCRIPTED');
});
await scenario('B17h', async () => {
  H().reset(); H().contextWindowImpl = () => Promise.reject(new domain.ExpressionError('QA486-HAR-CW domain-shaped'));
  const loop = await publishOk('B17h', chain('b17h', [inf()]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'x' });
  const f = res.snapshot.failure;
  const evs = await t.events(res.id);
  r.check('B17h', 'contextWindow throw keeps generic harness mapping (HARNESS_TURN_FAILED), not INTERNAL_ERROR/authored; no turn/start', f?.code === 'HARNESS_TURN_FAILED' && !f?.details?.boundary && turns(evs).length === 0 && H().counters.starts === 0 && H().counters.contextWindow === 1, { failure: f, cw: H().counters.contextWindow }, 'SCRIPTED');
  H().contextWindowImpl = undefined;
});

// ---------------- Resolver (catalog) and unusable-Q guard ----------------
await scenario('RES', async () => {
  H().reset();
  const loop = await publishOk('RES', chain('res', [{ id: 'w', kind: 'wait', label: 'w', config: { mode: 'signal', name: 'go' } }, inf()]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'res' }, { waitFor: ['waiting', 'failed'] });
  const off = await catalog(false);
  await t.rest('POST', `/runs/${res.id}/signals/go`, { waitId: res.snapshot.waiting?.waitId, payload: {} });
  const snap = await t.settle(res.id, ['failed', 'succeeded']);
  const evs = await t.events(res.id);
  r.check('RES', 'disabled model: restorable resolver failure EVALUATION_UNAVAILABLE resumable true, no harness.turn/start', off.status === 200 && snap.failure?.code === 'EVALUATION_UNAVAILABLE' && snap.failure?.resumable === true && turns(evs).length === 0 && H().counters.starts === 0, { off: off.status, failure: snap.failure }, 'PUBLIC-API+SCRIPTED');
  const on = await catalog(true);
  const resume = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: snap.recovery?.observedSeq ?? 0 });
  const done = await t.settle(res.id, ['succeeded', 'failed']);
  r.check('RES-restore', 're-enabled model: Resume succeeds with one start', on.status === 200 && resume.status === 200 && done.status === 'succeeded' && H().counters.starts === 1, { status: done.status, failure: done.failure }, 'PUBLIC-API+SCRIPTED');
});
await scenario('H-UG', async () => {
  H().reset(); H().script({ kind: 'rejectAfterHandle', session: false, accepted: false, error: Object.assign(new Error('QA486-HAR-UG'), { code: 'QA_UG' }) });
  const ws = fixedWs('hug');
  const loop = await publishOk('H-UG', chain('hug', [inf({ contextFiles: [{ path: 'a.txt', template: 'A' }] })], undefined, ws.settings));
  if (!loop) return;
  let target;
  setFault((runId, drafts) => (target === undefined || runId === target) && drafts.some((d) => d.type === 'run.failed'), 1, false);
  const started = await t.rest('POST', `/loops/${loop}/runs`, { input: { m: 'ug' } });
  target = started.json.run.id;
  const snap = await t.settle(target, ['failed', 'succeeded']);
  t.eventFault.match = undefined;
  r.check('H-UG-crash', 'SCRIPTED-STORAGE: node failure append faulted once; executor-crash path records ordinary INTERNAL_ERROR resumable true', snap.failure?.code === 'INTERNAL_ERROR' && snap.failure?.resumable === true && t.eventFault.fired >= 1, { failure: snap.failure, fired: t.eventFault.fired, log: t.eventFault.log.slice(-2) }, 'SCRIPTED-STORAGE');
  rmSync(join(ws.path, 'a.txt'), { force: true });
  const off = await catalog(false);
  const s0 = H().snapshot();
  const resume = await t.rest('POST', `/runs/${target}/resume`, { observedSeq: snap.recovery?.observedSeq ?? 0 });
  const after = await t.settle(target, ['failed', 'succeeded']);
  await catalog(true);
  r.check('H-UG', 'unusable-Q guard fires before resolver and prep: HARNESS_DELIVERY_UNCERTAIN (not EVALUATION_UNAVAILABLE despite disabled model), false, 0 harness calls, context file not rewritten', off.status === 200 && resume.status === 200 && after.failure?.code === 'HARNESS_DELIVERY_UNCERTAIN' && after.failure?.resumable === false && H().counters.starts === s0.starts && H().counters.resumes === s0.resumes && !existsSync(join(ws.path, 'a.txt')), { resume: resume.status, failure: after.failure, aExists: existsSync(join(ws.path, 'a.txt')) }, 'PUBLIC-API+SCRIPTED+NATIVE');
});
await scenario('RES-SM', async () => {
  // H-Q (usable) -> Resume -> provider reports session missing; its run.failed append is faulted
  // once (executor crash path, resumable INTERNAL_ERROR); then resolver unavailable; restore; reach
  // actionable HARNESS_SESSION_MISSING; explicit fresh session with saved prompt.
  H().reset();
  H().script({ kind: 'rejectAfterHandle', session: true, accepted: true, error: Object.assign(new Error('QA486-HAR-SM1'), { code: 'QA_Q' }) });
  H().script({ kind: 'errorEvent', code: 'HARNESS_SESSION_MISSING', message: 'QA486-HAR-SM session gone', submission: 'session-missing', session: false, accepted: false });
  const loop = await publishOk('RES-SM', chain('ressm', [inf()]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'sm' });
  const storedPrompt = turns(await t.events(res.id))[0]?.prompt;
  setFault((runId, drafts) => runId === res.id && drafts.some((d) => d.type === 'run.failed'), 1, false);
  const resume1 = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: res.snapshot.recovery?.observedSeq ?? 0 });
  const s1 = await t.settle(res.id, ['failed', 'succeeded']);
  t.eventFault.match = undefined;
  r.check('RES-SM-1', 'missing-session classification append faulted -> ordinary INTERNAL_ERROR resumable true', resume1.status === 200 && s1.failure?.code === 'INTERNAL_ERROR' && s1.failure?.resumable === true, { failure: s1.failure }, 'SCRIPTED-STORAGE');
  await catalog(false);
  const resume2 = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: s1.recovery?.observedSeq ?? 0 });
  const s2 = await t.settle(res.id, ['failed', 'succeeded']);
  r.check('RES-SM-2', 'resolver unavailable keeps its own code/resumability; prior turn provenance informational (same turnId); no harness call', resume2.status === 200 && s2.failure?.code === 'EVALUATION_UNAVAILABLE' && s2.failure?.resumable === true && s2.failure?.inference?.turnId && H().counters.starts === 1 && H().counters.resumes === 1, { failure: s2.failure, counters: H().counters }, 'PUBLIC-API+SCRIPTED');
  await catalog(true);
  const resume3 = await t.rest('POST', `/runs/${res.id}/resume`, { observedSeq: s2.recovery?.observedSeq ?? 0 });
  const s3 = await t.settle(res.id, ['failed', 'succeeded']);
  r.check('RES-SM-3', 'restored resolver reaches actionable HARNESS_SESSION_MISSING (false, missingSession) without a harness call', resume3.status === 200 && s3.failure?.code === 'HARNESS_SESSION_MISSING' && s3.failure?.resumable === false && s3.failure?.missingSession && H().counters.starts === 1 && H().counters.resumes === 1, { failure: s3.failure }, 'PUBLIC-API+SCRIPTED');
  const evs3 = await t.events(res.id);
  const rec = await t.rest('POST', `/runs/${res.id}/recover-session`, { nodeId: 'inf', failureSeq: failedSeq(evs3) });
  const s4 = await t.settle(res.id, ['failed', 'succeeded']);
  const call = H().calls.at(-1);
  r.check('FRESH-saved', 'explicit fresh session submits the saved authored prompt via start (no resume), succeeds', rec.status === 200 && s4.status === 'succeeded' && call?.kind === 'start' && call?.prompt === storedPrompt, { rec: rec.status, recBody: rec.status !== 200 ? rec.json : undefined, status: s4.status, call, storedPrompt }, 'PUBLIC-API+SCRIPTED');
});
await scenario('FRESH-unsaved', async () => {
  H().reset(); H().script({ kind: 'ok', session: false, accepted: true, finalText: 'first' });
  const nodes = [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'inf', kind: 'inference', label: 'Inf', config: { harness: 'codex', session: { policy: 'resume-own' }, prompt: { template: 'visit {{ trigger.payload.m }}' } } },
    { id: 'dec', kind: 'decision', label: 'Dec', config: { kind: 'expression', jsonata: '$count(messages[role="assistant"]) >= 2 ? "fin" : "again"', routes: [{ id: 'again', label: 'Again', repeat: true }, { id: 'fin', label: 'Fin' }], maxPasses: 3 } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"ok"' } },
  ];
  const edges = [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'inf' } }, { id: 'e2', from: { node: 'inf', port: 'out' }, to: { node: 'dec' } }, { id: 'e3', from: { node: 'dec', port: 'again' }, to: { node: 'inf' } }, { id: 'e4', from: { node: 'dec', port: 'fin' }, to: { node: 'done' } }, { id: 'e5', from: { node: 'dec', port: 'limit-reached' }, to: { node: 'done' } }]; // attempt-2: limit-reached port must be connected
  const loop = await publishOk('FRESH-unsaved', { name: 'fresh unsaved', nodes, edges });
  if (!loop) return;
  const res = await t.run(loop, { m: 'fu' });
  const f = res.snapshot.failure;
  const evs = await t.events(res.id);
  r.check('FRESH-unsaved-missing', 'second resume-own visit with no recorded previous session: HARNESS_SESSION_MISSING, no new harness.turn for the visit', f?.code === 'HARNESS_SESSION_MISSING' && H().counters.starts === 1 && turns(evs).length === 1, { failure: f, starts: H().counters.starts }, 'PUBLIC-API+SCRIPTED');
  const rec = await t.rest('POST', `/runs/${res.id}/recover-session`, { nodeId: 'inf', failureSeq: failedSeq(evs) });
  const done = await t.settle(res.id, ['failed', 'succeeded']);
  const call = H().calls.at(-1);
  r.check('FRESH-unsaved', 'explicit fresh session without saved prompt renders the prompt and starts fresh', rec.status === 200 && call?.kind === 'start' && call?.prompt === 'visit fu' && H().counters.starts === 2 && done.status === 'succeeded', { rec: rec.status, recBody: rec.status !== 200 ? rec.json : undefined, status: done.status, failure: done.failure, call }, 'PUBLIC-API+SCRIPTED');
});

// ---------------- RETRY: exact retry evidence across a resumable prep failure and clean restart ----------------
let retryRun, retryEvidence;
await scenario('RETRY-1', async () => {
  H().reset();
  const loop = await publishOk('RETRY', chain('retry', [inf()]));
  if (!loop) return;
  let target;
  setFault((runId, drafts) => (target === undefined || runId === target) && drafts.some((d) => d.type === 'harness.turn'), 2, false);
  const started = await t.rest('POST', `/loops/${loop}/runs`, { input: { m: 'retry' } });
  target = started.json.run.id;
  retryRun = target;
  const s1 = await t.settle(target, ['failed', 'succeeded']);
  t.eventFault.match = undefined;
  retryEvidence = s1.failure?.inference;
  const evs = await t.events(target);
  r.check('RETRY-1', 'intent append and reconcile both faulted: failure carries inference.retry with exact prompt, definitely-not-submitted, no harness call, no harness.turn', s1.failure?.inference?.retry?.prompt === 'QA prompt retry' && s1.failure?.inference?.submission === 'definitely-not-submitted' && H().counters.starts === 0 && turns(evs).length === 0 && s1.failure?.resumable === true, { failure: s1.failure, fired: t.eventFault.fired, log: t.eventFault.log.slice(-3), turns: turns(evs).length }, 'SCRIPTED-STORAGE');
  await catalog(false);
  const resume = await t.rest('POST', `/runs/${target}/resume`, { observedSeq: s1.recovery?.observedSeq ?? 0 });
  const s2 = await t.settle(target, ['failed', 'succeeded']);
  r.check('RETRY-2', 'later resumable prep failure: EVALUATION_UNAVAILABLE true, same turnId, no re-emitted retry object, no harness call', resume.status === 200 && s2.failure?.code === 'EVALUATION_UNAVAILABLE' && s2.failure?.resumable === true && s2.failure?.inference?.turnId === retryEvidence?.turnId && !('retry' in (s2.failure?.inference ?? {})) && H().counters.starts === 0, { failure: s2.failure }, 'PUBLIC-API+SCRIPTED');
});

writeFileSync(join(OUT, 'd4.logger.json'), JSON.stringify(t.logger.lines, null, 1));
await scenario('LOG', async () => {
  const hits = t.logger.lines.filter((l) => /QA486-(LIT|IN|PATH)/.test(JSON.stringify(l.obj) + l.msg));
  r.check('LOG', 'no captured log record contains QA486-LIT/IN/PATH', hits.length === 0, { hits: hits.map((h) => JSON.stringify(h).slice(0, 500)) }, 'SCRIPTED-LOGGER');
});
// Clean restart on the same data dir, then complete the exact retry.
const keys = t.keys;
const dataDir = t.dataDir;
const shut1 = await t.shutdown();
r.check('RESTART', 'authenticated drain and close before reopening the same store', shut1.drainStatus === 202 && shut1.portRefused === true, shut1, 'CLEANUP');
t = await boot({ name: 'd4', port: 5873, dataDir, existingKeys: keys });
await scenario('RETRY-3', async () => {
  if (!retryRun) return;
  const before = await t.settle(retryRun, ['failed', 'succeeded']);
  const on = await catalog(true);
  const resume = await t.rest('POST', `/runs/${retryRun}/resume`, { observedSeq: before.recovery?.observedSeq ?? 0 });
  const done = await t.settle(retryRun, ['failed', 'succeeded']);
  const evs = await t.events(retryRun);
  const call = H().calls.at(-1);
  r.check('RETRY-3', 'after restart and repair: exact retry from the first event (same prompt, same turnId, start not resume), one harness call, succeeded', on.status === 200 && resume.status === 200 && done.status === 'succeeded' && H().counters.starts === 1 && call?.prompt === retryEvidence?.retry?.prompt && turns(evs).length === 1 && turns(evs)[0].turnId === retryEvidence?.turnId, { status: done.status, failure: done.failure, call, turnIds: turns(evs).map((x) => x.turnId), evidence: retryEvidence }, 'PUBLIC-API+SCRIPTED');
});
writeFileSync(join(OUT, 'd4.logger-after-restart.json'), JSON.stringify(t.logger.lines, null, 1));
const shut = await t.shutdown();
r.check('CLEANUP', 'authenticated drain accepted; API port refuses connections', shut.drainStatus === 202 && shut.portRefused === true, shut, 'CLEANUP');
r.finish({ driverPid: process.pid, apiPort: 5873, dataDir });
process.exit(0);
