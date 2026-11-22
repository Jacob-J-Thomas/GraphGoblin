// D2 leaf boundaries over a disposable built API (PUBLIC-API + NATIVE + SCRIPTED counters).
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, WORK, recorder, containsAny } from './lib/rec.mjs';
import { boot, chain, startListener, counterLines, FIXTURE_APPEND, NODE_EXE, domain, countType, sleep } from './lib/boot.mjs';
import { failureParity, authoredShape, TEMPLATE_RENDER, EXPR_EVAL, TIMESTAMP, canon } from './lib/checks.mjs';

const r = recorder('d2');
const listener = await startListener();
const t = await boot({ name: 'd2', port: 5871 });
r.raw('resources', { driverPid: process.pid, apiPort: 5871, listenerPort: listener.port, dataDir: t.dataDir });
const sinks = join(WORK, 'sinks');
const { mkdirSync } = await import('node:fs');
mkdirSync(sinks, { recursive: true });
const counter = (name) => join(sinks, `${name}.counter.jsonl`);
const inc = (p) => `{% include "QA486-PATH-${p}" %}`;
const scriptNode = (id, args, extra = {}) => ({ id, kind: 'script', label: id, config: { command: NODE_EXE, args: [FIXTURE_APPEND, ...args], stdin: 'none', stdout: 'ignore', ...extra } });
const hb = (id, config) => ({ id, kind: 'heartbeat', label: id, config });

async function scenario(id, fn) {
  try {
    await fn();
  } catch (error) {
    r.check(`${id}-crash`, 'scenario completed without driver exception', false, { error: String(error?.stack ?? error) }, 'INSTRUMENTATION');
  }
}

async function publishOk(id, def) {
  const p = await t.publish(def);
  r.raw(`${id}-publish`, { status: p.published?.status, issues: p.published?.json?.issues, created: p.created?.status, body: p.ok ? undefined : p.published?.json ?? p.created?.json });
  if (!p.ok) r.check(`${id}-setup`, 'fixture publishes (setup)', false, p.published?.json ?? p.created?.json, 'SETUP');
  return p.ok ? p.loopId : undefined;
}

const wsDir = (runId) => join(t.dataDir, 'workspaces', runId);

// ---------------- L-PUB: publish validation makes compile/unsafe/parse runtime-unreachable ----------
await scenario('L-PUB', async () => {
  const before = (await t.rest('GET', '/runs')).json?.items?.length ?? 0;
  for (const [tag, until] of [['compile', '1 +'], ['unsafe', '$match("aaaa", /(a+)+$/)']]) {
    const p = await t.publish(chain(`lpub ${tag}`, [hb('h', { intervalSeconds: 1, maxBeats: 1, until })]));
    r.check(`L-PUB-${tag}`, `top-level ${tag} expression refused at publish`, p.ok === false && [400, 422].includes(p.published?.status ?? p.created?.status), { status: p.published?.status ?? p.created?.status, body: p.published?.json ?? p.created?.json }, 'PUBLIC-API');
  }
  const p = await t.publish(chain('lpub liquid', [scriptNode('s', [counter('lpub'), '{% if %}'])]));
  r.check('L-PUB-liquid', 'Liquid parse error refused at publish', p.ok === false, { status: p.published?.status ?? p.created?.status, body: p.published?.json ?? p.created?.json }, 'PUBLIC-API');
  const after = (await t.rest('GET', '/runs')).json?.items?.length ?? 0;
  r.check('L-PUB-runs', 'no runs created by refused publications', before === after, { before, after }, 'PUBLIC-API');
});

// ---------------- B01 / B01c / B01u / EXT-W (script) ----------------
await scenario('B01', async () => {
  const c = counter('b01');
  const loop = await publishOk('B01', chain('b01', [scriptNode('s', [c, 'QA-B01', inc('B01')])]));
  if (!loop) return;
  const res = await t.run(loop, { m: 'QA486-IN-B01' });
  const evs = await t.events(res.id);
  authoredShape(r, 'B01', res.snapshot.failure, { code: 'TEMPLATE_ERROR', nodeId: 's', boundary: 'script.args', indices: { argumentIndex: 3 }, cause: TEMPLATE_RENDER, message: (c2) => `Script argument 4 failed. ${c2}` }, 'PUBLIC-API+NATIVE');
  r.check('B01-effects', 'native counter +0 and zero script.dispatched', counterLines(c).length === 0 && countType(evs, 'script.dispatched') === 0, { lines: counterLines(c).length, dispatched: countType(evs, 'script.dispatched') }, 'NATIVE');
  await failureParity(t, r, res.id, res.snapshot, { tag: 'B01', effects: async () => ({ lines: counterLines(c).length }) });
});
await scenario('B01c', async () => {
  const c = counter('b01c');
  const loop = await publishOk('B01c', chain('b01c', [scriptNode('s', [c, 'QA-B01C', '{{ trigger.payload.v }}'])]));
  if (!loop) return;
  const res = await t.run(loop, { v: 'ctrl-value' });
  const evs = await t.events(res.id);
  const lines = counterLines(c);
  r.check('B01c', 'valid args: succeeded, native counter +1 with exact args, one script.dispatched, cwd = temp workspace', res.snapshot.status === 'succeeded' && lines.length === 1 && canon(lines[0].args) === canon(['QA-B01C', 'ctrl-value']) && countType(evs, 'script.dispatched') === 1 && lines[0].cwd.toLowerCase() === wsDir(res.id).toLowerCase(), { status: res.snapshot.status, lines, ws: wsDir(res.id) }, 'NATIVE');
});
await scenario('B01u', async () => {
  const loop = await publishOk('B01u', chain('b01u', [{ id: 's', kind: 'script', label: 's', config: { command: join(WORK, 'no-such-dir', 'missing-qa486.exe'), args: [], stdin: 'none' } }]));
  if (!loop) return;
  const res = await t.run(loop);
  const f = res.snapshot.failure;
  r.check('B01u', 'nonexistent command keeps existing script start/uncertain policy (no authored boundary)', ['SCRIPT_START_FAILED', 'SCRIPT_OUTCOME_UNCERTAIN'].includes(f?.code) && !f?.details?.boundary, { failure: f }, 'NATIVE');
});
await scenario('EXT-W', async () => {
  const c = counter('extw');
  const loop = await publishOk('EXT-W', chain('extw', [scriptNode('s', [c, 'x'], { env: { QA: 'secret:qa486-missing' } })]));
  if (!loop) return;
  const res = await t.run(loop);
  r.check('EXT-W', 'missing secret keeps SECRET_MISSING; counter +0', res.snapshot.failure?.code === 'SECRET_MISSING' && counterLines(c).length === 0, { failure: res.snapshot.failure }, 'NATIVE');
});

// ---------------- Heartbeat B02–B06 ----------------
async function hbAuthored(tag, cfg, expect, input, { listenerDelta = 0, beats = 0 } = {}) {
  const loop = await publishOk(tag, chain(tag, [hb('h', cfg)]));
  if (!loop) return;
  const before = listener.count();
  const res = await t.run(loop, input, { waitFor: ['succeeded', 'failed', 'cancelled', 'exhausted'] });
  const evs = await t.events(res.id);
  authoredShape(r, tag, res.snapshot.failure, { nodeId: 'h', ...expect }, 'PUBLIC-API+NATIVE');
  r.check(`${tag}-effects`, `listener +${listenerDelta}, heartbeat.beat ${beats}, not waiting`, listener.count() - before === listenerDelta && countType(evs, 'heartbeat.beat') === beats && res.snapshot.status === 'failed', { listenerDelta: listener.count() - before, beats: countType(evs, 'heartbeat.beat'), status: res.snapshot.status }, 'NATIVE');
  await failureParity(t, r, res.id, res.snapshot, { tag, effects: async () => ({ listener: listener.count() }) });
  return { res, evs };
}
await scenario('B02', () => hbAuthored('B02', { intervalSeconds: 1, maxBeats: 1, probe: { kind: 'http', method: 'GET', url: `${listener.url}/b02`, headers: { a: 'ok', b: inc('B02') } } }, { code: 'TEMPLATE_ERROR', boundary: 'heartbeat.probe.headers', indices: { headerIndex: 1 }, cause: TEMPLATE_RENDER, message: (c) => `Heartbeat probe header 2 failed. ${c}` }));
await scenario('B03u', () => hbAuthored('B03u', { intervalSeconds: 1, maxBeats: 1, probe: { kind: 'http', method: 'GET', url: inc('B03U') } }, { code: 'TEMPLATE_ERROR', boundary: 'heartbeat.probe.url', cause: TEMPLATE_RENDER, message: (c) => `Heartbeat probe URL failed. ${c}` }));
await scenario('B03b', () => hbAuthored('B03b', { intervalSeconds: 1, maxBeats: 1, probe: { kind: 'http', method: 'POST', url: `${listener.url}/b03b`, body: `x ${inc('B03B')}` } }, { code: 'TEMPLATE_ERROR', boundary: 'heartbeat.probe.body', cause: TEMPLATE_RENDER, message: (c) => `Heartbeat probe body failed. ${c}` }));
await scenario('B03c', async () => {
  const loop = await publishOk('B03c', chain('b03c', [hb('h', { intervalSeconds: 1, maxBeats: 3, probe: { kind: 'http', method: 'POST', url: `${listener.url}/b03c`, headers: { 'x-qa': '{{ trigger.payload.h }}' }, body: 'body-{{ trigger.payload.h }}' }, until: 'probe.status = 200' })]));
  if (!loop) return;
  const before = listener.count();
  const res = await t.run(loop, { h: 'hdr-ctrl' }, { waitFor: ['succeeded', 'failed'] });
  const evs = await t.events(res.id);
  const req = listener.requests.at(-1);
  r.check('B03c', 'valid probe: succeeded, listener +1 with rendered header/body, one beat', res.snapshot.status === 'succeeded' && listener.count() - before === 1 && req.headers['x-qa'] === 'hdr-ctrl' && req.body === 'body-hdr-ctrl' && countType(evs, 'heartbeat.beat') === 1, { status: res.snapshot.status, delta: listener.count() - before, req: { url: req?.url, h: req?.headers['x-qa'], body: req?.body }, beats: countType(evs, 'heartbeat.beat') }, 'NATIVE');
});
await scenario('B04', async () => {
  const c = counter('b04');
  const out = await hbAuthored('B04', { intervalSeconds: 1, maxBeats: 1, probe: { kind: 'script', command: NODE_EXE, args: [FIXTURE_APPEND, c, inc('B04')] } }, { code: 'TEMPLATE_ERROR', boundary: 'heartbeat.probe.args', indices: { argumentIndex: 2 }, cause: TEMPLATE_RENDER, message: (cc) => `Heartbeat probe argument 3 failed. ${cc}` });
  if (out) r.check('B04-native', 'script-probe counter +0 and no temp workspace resolved for the run', counterLines(c).length === 0 && !existsSync(wsDir(out.res.id)), { lines: counterLines(c).length, wsExists: existsSync(wsDir(out.res.id)) }, 'NATIVE');
});
await scenario('B04c', async () => {
  const c = counter('b04c');
  const loop = await publishOk('B04c', chain('b04c', [hb('h', { intervalSeconds: 1, maxBeats: 1, probe: { kind: 'script', command: NODE_EXE, args: [FIXTURE_APPEND, c, 'probe-ok'] }, until: 'probe.exitCode = 0' })]));
  if (!loop) return;
  const res = await t.run(loop, undefined, { waitFor: ['succeeded', 'failed'] });
  r.check('B04c', 'valid script probe: succeeded, counter +1, cwd = temp workspace', res.snapshot.status === 'succeeded' && counterLines(c).length === 1 && counterLines(c)[0].cwd.toLowerCase() === wsDir(res.id).toLowerCase(), { status: res.snapshot.status, lines: counterLines(c) }, 'NATIVE');
});
await scenario('B05', () => hbAuthored('B05', { intervalSeconds: 1, maxBeats: 5, probe: { kind: 'http', method: 'GET', url: `${listener.url}/b05` }, until: '$error("QA486-LIT-B05")' }, { code: 'EXPRESSION_ERROR', boundary: 'heartbeat.until', indices: { beat: 1 }, cause: EXPR_EVAL, message: (c) => `Heartbeat until predicate, beat 1 failed. ${c}` }, undefined, { listenerDelta: 1, beats: 1 }));
await scenario('B05b', () => hbAuthored('B05b', { intervalSeconds: 1, maxBeats: 5, probe: { kind: 'http', method: 'GET', url: `${listener.url}/b05b` }, until: 'beat = 2 ? $error("QA486-LIT-B05B") : false' }, { code: 'EXPRESSION_ERROR', boundary: 'heartbeat.until', indices: { beat: 2 }, cause: EXPR_EVAL, message: (c) => `Heartbeat until predicate, beat 2 failed. ${c}` }, undefined, { listenerDelta: 2, beats: 2 }));
await scenario('B05d', () => hbAuthored('B05d', { intervalSeconds: 1, maxBeats: 5, probe: { kind: 'http', method: 'GET', url: `${listener.url}/b05d` }, until: '$error("QA486-" & probe.json.k)' }, { code: 'EXPRESSION_ERROR', boundary: 'heartbeat.until', indices: { beat: 1 }, cause: EXPR_EVAL, message: (c) => `Heartbeat until predicate, beat 1 failed. ${c}` }, undefined, { listenerDelta: 1, beats: 1 }));
await scenario('B06t', () => hbAuthored('B06t', { intervalSeconds: 1, maxBeats: 5, probe: { kind: 'http', method: 'GET', url: `${listener.url}/b06t` }, until: 'false', deadline: '{{ trigger.payload.dl }}' }, { code: 'TEMPLATE_ERROR', boundary: 'heartbeat.deadline', indices: { beat: 1 }, cause: TIMESTAMP, message: (c) => `Heartbeat deadline, beat 1 failed. ${c}` }, { dl: 'QA486-IN-B06' }, { listenerDelta: 1, beats: 1 }));
await scenario('B06l', () => hbAuthored('B06l', { intervalSeconds: 1, maxBeats: 5, probe: { kind: 'http', method: 'GET', url: `${listener.url}/b06l` }, until: 'false', deadline: inc('B06L') }, { code: 'TEMPLATE_ERROR', boundary: 'heartbeat.deadline', indices: { beat: 1 }, cause: TEMPLATE_RENDER, message: (c) => `Heartbeat deadline, beat 1 failed. ${c}` }, undefined, { listenerDelta: 1, beats: 1 }));
await scenario('B06c', async () => {
  const loop = await publishOk('B06c', chain('b06c', [hb('h', { intervalSeconds: 1, maxBeats: 5, probe: { kind: 'http', method: 'GET', url: `${listener.url}/b06c` }, until: 'true', deadline: inc('B06C') })]));
  if (!loop) return;
  const res = await t.run(loop, undefined, { waitFor: ['succeeded', 'failed'] });
  r.check('B06c', 'until true wins: invalid deadline never rendered, succeeded', res.snapshot.status === 'succeeded', { status: res.snapshot.status, failure: res.snapshot.failure }, 'NATIVE');
});

// ---------------- Decisions B20/B21/B22 ----------------
const routes = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
function decisionLoop(name, config, pre = []) {
  const nodes = [{ id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } }, ...pre, { id: 'd', kind: 'decision', label: 'D', config }, { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"ok"' } }];
  const edges = [];
  const seq = ['start', ...pre.map((p) => p.id), 'd'];
  for (let i = 0; i < seq.length - 1; i++) edges.push({ id: `e${i}`, from: { node: seq[i], port: 'out' }, to: { node: seq[i + 1] } });
  const ports = config.answer ? config.answer.options.map((o) => o.id) : config.routes.map((x) => x.id);
  ports.forEach((p, i) => edges.push({ id: `r${i}`, from: { node: 'd', port: p }, to: { node: 'done' } }));
  return { name, nodes, edges };
}
const appendMsg = { id: 'm', kind: 'mutate', label: 'm', config: { operations: [{ op: 'append-message', role: 'user', content: 'hello {{ trigger.payload.m }}' }] } };
const llm = (extra) => ({ kind: 'llm', instructions: 'Pick a route.', harness: 'codex', model: { mode: 'inherit' }, effort: { mode: 'inherit' }, routes, ...extra });
const classifierCfg = (extra) => ({ kind: 'classifier', model: 'jev', question: 'Which?', answer: { type: 'choice', options: [{ id: 'a', label: 'A', criteria: 'first' }, { id: 'b', label: 'B', criteria: 'second' }] }, ...extra });

// Attempt-2 instrumentation fix: classifier publication requires a configured secret in the
// disposable store (attempt 1: LOOP_INVALID CLASSIFIER_SECRET_MISSING). Dummy value, scratch store only;
// the scripted classifier registry never sends it anywhere.
{
  const s = await t.rest('PUT', '/secrets/jev-api-key', { value: 'qa486-disposable-not-a-credential' });
  r.raw('classifier-secret-setup', { status: s.status });
}
async function decisionAuthored(tag, cfg, expect, pre) {
  const loop = await publishOk(tag, decisionLoop(tag, cfg, pre));
  if (!loop) return;
  const d0 = t.decider.calls.length, c0 = t.classifier.calls.length;
  const res = await t.run(loop, { m: 'QA486-IN-' + tag });
  authoredShape(r, tag, res.snapshot.failure, { nodeId: 'd', ...expect });
  r.check(`${tag}-provider`, 'SCRIPTED decider/classifier calls +0', t.decider.calls.length === d0 && t.classifier.calls.length === c0, { decider: t.decider.calls.length - d0, classifier: t.classifier.calls.length - c0 }, 'SCRIPTED');
  await failureParity(t, r, res.id, res.snapshot, { tag });
}
await scenario('B21l', () => decisionAuthored('B21l', llm({ instructions: `Pick ${inc('B21L')}` }), { code: 'TEMPLATE_ERROR', boundary: 'decision.instructions', cause: TEMPLATE_RENDER, message: (c) => `Decision instructions failed. ${c}` }));
await scenario('B21c', () => decisionAuthored('B21c', classifierCfg({ question: `Which ${inc('B21C')}` }), { code: 'TEMPLATE_ERROR', boundary: 'decision.question', cause: TEMPLATE_RENDER, message: (c) => `Decision question failed. ${c}` }));
await scenario('B22', () => decisionAuthored('B22', llm({ context: { messages: { where: '$error("QA486-LIT-B22")' } } }), { code: 'EXPRESSION_ERROR', boundary: 'decision.context.messages.where', indices: { itemIndex: 0 }, cause: EXPR_EVAL, message: (c) => `Decision context message selector, item 1 failed. ${c}` }, [appendMsg]));
await scenario('B22c', async () => {
  const loop = await publishOk('B22c', decisionLoop('b22c', llm({ context: { messages: { where: 'role = "user"' } } }), [appendMsg]));
  if (!loop) return;
  const d0 = t.decider.calls.length;
  const res = await t.run(loop, { m: 'ctrl' });
  r.check('B22c', 'valid selector: succeeded, decider called once', res.snapshot.status === 'succeeded' && t.decider.calls.length - d0 === 1, { status: res.snapshot.status, failure: res.snapshot.failure }, 'SCRIPTED');
});
await scenario('B20', async () => {
  const loop = await publishOk('B20', decisionLoop('b20', { kind: 'expression', jsonata: '$error("QA486-LIT-B20")', routes }));
  if (!loop) return;
  const res = await t.run(loop);
  const f = res.snapshot.failure;
  r.check('B20', 'route expression keeps EVALUATION_EXPRESSION_FAILED fixed copy, false, no boundary, literal absent', f?.code === 'EVALUATION_EXPRESSION_FAILED' && f?.message === 'The evaluation expression could not be evaluated' && f?.resumable === false && !f?.details?.boundary && containsAny(f, ['QA486-LIT-B20']).length === 0, { failure: f }, 'PUBLIC-API');
  await failureParity(t, r, res.id, res.snapshot, { tag: 'B20' });
});
for (const [k, err] of [['real', () => new domain.ExpressionError('QA486-EXT-C real domain error')], ['name', () => Object.assign(new Error('QA486-EXT-C name spoof'), { name: 'ExpressionError' })], ['code', () => ({ code: 'EXPRESSION_ERROR', message: 'QA486-EXT-C code spoof' })]]) {
  await scenario(`EXT-C-${k}`, async () => {
    const loop = await publishOk(`EXT-C-${k}`, decisionLoop(`extc ${k}`, classifierCfg({})));
    if (!loop) return;
    t.classifier.failNext.push(err());
    const res = await t.run(loop);
    const f = res.snapshot.failure;
    r.check(`EXT-C-${k}`, 'classifier callback rejection: provider/internal path, not authored; marker absent', f && !f.details?.boundary && f.code !== 'EXPRESSION_ERROR' && containsAny(f, ['QA486-EXT']).length === 0, { failure: f, status: res.snapshot.status }, 'SCRIPTED');
  });
}

// ---------------- Wait B23/B24/B25 ----------------
await scenario('B23', async () => {
  const loop = await publishOk('B23', chain('b23', [{ id: 'w', kind: 'wait', label: 'w', config: { mode: 'input', prompt: `Answer ${inc('B23')}` } }]));
  if (!loop) return;
  const res = await t.run(loop);
  const evs = await t.events(res.id);
  authoredShape(r, 'B23', res.snapshot.failure, { code: 'TEMPLATE_ERROR', nodeId: 'w', boundary: 'wait.prompt', cause: TEMPLATE_RENDER, message: (c) => `Wait input prompt failed. ${c}` });
  r.check('B23-effects', 'never parked: no run.waiting/wait events, status failed', res.snapshot.status === 'failed' && !evs.some((e) => /wait/.test(e.type)), { types: evs.map((e) => e.type) }, 'PUBLIC-API');
  await failureParity(t, r, res.id, res.snapshot, { tag: 'B23' });
});
await scenario('B24', async () => {
  const loop = await publishOk('B24', chain('b24', [{ id: 'w', kind: 'wait', label: 'w', config: { mode: 'until', timestamp: '{{ trigger.payload.ts }}' } }]));
  if (!loop) return;
  const res = await t.run(loop, { ts: 'QA486-IN-B24' });
  authoredShape(r, 'B24', res.snapshot.failure, { code: 'TEMPLATE_ERROR', nodeId: 'w', boundary: 'wait.timestamp', cause: TIMESTAMP, message: (c) => `Wait timestamp failed. ${c}` });
  await failureParity(t, r, res.id, res.snapshot, { tag: 'B24' });
});
await scenario('B25', async () => {
  const loop = await publishOk('B25', chain('b25', [{ id: 'w', kind: 'wait', label: 'w', config: { mode: 'signal', name: 'go', filter: '$error("QA486-LIT-B25")' } }]));
  if (!loop) return;
  const res = await t.run(loop, undefined, { waitFor: ['waiting', 'failed', 'succeeded'] });
  const waitId = res.snapshot.waiting?.waitId;
  const before = await t.events(res.id);
  const sig = await t.rest('POST', `/runs/${res.id}/signals/go`, { waitId, payload: { ok: true } });
  await sleep(300);
  const after = await t.events(res.id);
  const snap2 = (await t.rest('GET', `/runs/${res.id}`)).json;
  r.check('B25', 'rejected signal: HTTP 400 EXPRESSION_ERROR request copy; run still waiting with same waitId; zero added events', sig.status === 400 && sig.json?.code === 'EXPRESSION_ERROR' && snap2.status === 'waiting' && snap2.waiting?.waitId === waitId && after.length === before.length && countType(after, 'signal.received') === 0 && countType(after, 'run.failed') === 0, { sig: sig.json, sigStatus: sig.status, status: snap2.status, waitId, waitId2: snap2.waiting?.waitId, added: after.length - before.length, literalInRequestCopy: containsAny(sig.json, ['QA486-LIT-B25']) }, 'PUBLIC-API');
  const cancel = await t.rest('POST', `/runs/${res.id}/cancel`, {});
  r.raw('B25-cleanup-cancel', { status: cancel.status });
});
await scenario('B25c', async () => {
  const loop = await publishOk('B25c', chain('b25c', [{ id: 'w', kind: 'wait', label: 'w', config: { mode: 'signal', name: 'go', filter: 'ok = true' } }]));
  if (!loop) return;
  const res = await t.run(loop, undefined, { waitFor: ['waiting', 'failed', 'succeeded'] });
  const sig = await t.rest('POST', `/runs/${res.id}/signals/go`, { waitId: res.snapshot.waiting?.waitId, payload: { ok: true } });
  const done = await t.settle(res.id, ['succeeded', 'failed']);
  r.check('B25c', 'valid filter: signal wakes and run succeeds', sig.status === 200 && sig.json?.woke === true && done.status === 'succeeded', { sig: sig.json?.woke, status: done.status }, 'PUBLIC-API');
});

// ---------------- P01 / P02 ----------------
await scenario('P01', async () => {
  const loop = await publishOk('P01', chain('p01', [{ id: 'm', kind: 'mutate', label: 'm', config: { operations: [{ op: 'set', path: '/vars/x', value: { kind: 'expression', jsonata: '$error("QA486-LIT-P01")' } }] } }]));
  if (!loop) return;
  const res = await t.run(loop);
  const f = res.snapshot.failure;
  r.check('P01', 'Mutate keeps MUTATION_ERROR "Mutation operation 1 (set) failed: <bounded authored text>" with literal present, false', f?.code === 'MUTATION_ERROR' && f?.message.startsWith('Mutation operation 1 (set) failed: ') && f?.message.includes('QA486-LIT-P01') && f?.resumable === false && f?.details?.operationKind === 'set' && !f?.details?.boundary, { failure: f }, 'PUBLIC-API');
  await failureParity(t, r, res.id, res.snapshot, { tag: 'P01', markers: ['QA486-IN', 'QA486-PATH', 'QA486-EXT'] });
});
await scenario('P02', async () => {
  const loop = await publishOk('P02', chain('p02', [], { returns: '$error("QA486-LIT-P02")' }));
  if (!loop) return;
  const res = await t.run(loop);
  const f = res.snapshot.failure;
  r.check('P02', 'Exit keeps EXPRESSION_ERROR with bounded expression message (literal present), false, no boundary', f?.code === 'EXPRESSION_ERROR' && f?.message.includes('QA486-LIT-P02') && f?.resumable === false && !f?.details?.boundary, { failure: f }, 'PUBLIC-API');
});

// ---------------- EXT-H / EXT-S (same-class external port rejections) ----------------
const extErrors = (tag) => [
  ['real', () => new domain.ExpressionError(`QA486-EXT-${tag} real domain error`)],
  ['name', () => Object.assign(new Error(`QA486-EXT-${tag} name spoof`), { name: 'ExpressionError' })],
  ['code', () => ({ code: 'EXPRESSION_ERROR', message: `QA486-EXT-${tag} code spoof` })],
];
for (const [k, make] of extErrors('H')) {
  await scenario(`EXT-H-${k}`, async () => {
    const loop = await publishOk(`EXT-H-${k}`, chain(`exth ${k}`, [hb('h', { intervalSeconds: 1, maxBeats: 1, probe: { kind: 'http', method: 'GET', url: `${listener.url}/exth` }, until: 'true' })]));
    if (!loop) return;
    const before = listener.count();
    t.inject.probe.push(make());
    const res = await t.run(loop, undefined, { waitFor: ['succeeded', 'failed'] });
    const evs = await t.events(res.id);
    const f = res.snapshot.failure;
    const logged = t.logger.lines.filter((l) => JSON.stringify(l.obj).includes(`QA486-EXT-H`)).length;
    r.check(`EXT-H-${k}`, 'probe port rejection -> INTERNAL_ERROR safe copy, resumable true, no boundary, marker absent; 0 beats; listener +0', f?.code === 'INTERNAL_ERROR' && f?.resumable === true && !f?.details?.boundary && containsAny([f, evs.filter((e) => e.type === 'run.failed')], ['QA486-EXT']).length === 0 && countType(evs, 'heartbeat.beat') === 0 && listener.count() === before, { failure: f, beats: countType(evs, 'heartbeat.beat'), privateLogRecordsWithMarker: logged }, 'SCRIPTED-INJECT');
  });
}
for (const [k, make] of extErrors('S')) {
  await scenario(`EXT-S-${k}`, async () => {
    const c = counter(`exts-${k}`);
    const loop = await publishOk(`EXT-S-${k}`, chain(`exts ${k}`, [scriptNode('s', [c, 'x'])]));
    if (!loop) return;
    t.inject.script.push(make());
    const res = await t.run(loop);
    const evs = await t.events(res.id);
    const f = res.snapshot.failure;
    r.check(`EXT-S-${k}`, 'runner rejection after dispatch -> SCRIPT_OUTCOME_UNCERTAIN, 1 script.dispatched, outcome-uncertain, no boundary, marker absent', f?.code === 'SCRIPT_OUTCOME_UNCERTAIN' && countType(evs, 'script.dispatched') === 1 && f?.script?.state === 'outcome-uncertain' && !f?.details?.boundary && containsAny(f, ['QA486-EXT']).length === 0 && counterLines(c).length === 0, { failure: f, dispatched: countType(evs, 'script.dispatched'), recovery: res.snapshot.recovery?.resume }, 'SCRIPTED-INJECT');
  });
}

// ---------------- LOG: no new raw evaluator text logged from new JSONata/Liquid sites ----------------
await scenario('LOG', async () => {
  const hits = t.logger.lines.filter((l) => /QA486-(LIT|IN|PATH)/.test(JSON.stringify(l.obj) + l.msg));
  const authoredLogs = t.logger.lines.filter((l) => JSON.stringify(l.obj).includes('"boundary"'));
  r.check('LOG', 'no captured log record contains QA486-LIT/IN/PATH (P01/P02 literal excluded only if present by established contract)', hits.every((h) => /QA486-LIT-P0[12]/.test(JSON.stringify(h.obj))), { hits: hits.map((h) => ({ level: h.level, msg: h.msg, obj: JSON.stringify(h.obj).slice(0, 600) })), authoredLogCount: authoredLogs.length, totalLines: t.logger.lines.length }, 'SCRIPTED-LOGGER');
});

writeFileSync(join(OUT, 'd2.logger.json'), JSON.stringify(t.logger.lines, null, 1));
const shut = await t.shutdown();
await listener.close();
const listenerGone = await (await import('./lib/boot.mjs')).portRefuses(listener.port);
r.check('CLEANUP', 'authenticated drain accepted, API port and probe listener refuse connections after shutdown', shut.drainStatus === 202 && shut.portRefused === true && listenerGone === true, { ...shut, listenerPort: listener.port, listenerGone }, 'CLEANUP');
r.finish({ driverPid: process.pid, apiPort: 5871, listenerPort: listener.port, dataDir: t.dataDir, harness: t.harness.codex.snapshot().starts, deciderCalls: t.decider.calls.length, classifierCalls: t.classifier.calls.length, inject: { probeCalls: t.inject.probeCalls, probeInjected: t.inject.probeInjected, scriptCalls: t.inject.scriptCalls, scriptInjected: t.inject.scriptInjected } });
process.exit(0);
