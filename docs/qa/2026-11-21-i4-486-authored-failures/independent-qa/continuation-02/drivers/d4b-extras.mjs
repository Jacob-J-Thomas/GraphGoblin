// D4b extras: LLM decider and structured-coerce external lookalikes (SCRIPTED ports), and the B17
// positive control (real canonical system-chat history trim/fit success through the public API).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OUT, recorder, containsAny } from './lib/rec.mjs';
import { boot, chain, domain, contracts, countType } from './lib/boot.mjs';

const r = recorder('d4b');
const t = await boot({ name: 'd4b', port: 5878 });
const H = () => t.harness.codex;
r.raw('resources', { driverPid: process.pid, apiPort: 5878, dataDir: t.dataDir });
async function scenario(id, fn) {
  try { await fn(); } catch (error) { r.check(`${id}-crash`, 'scenario completed without driver exception', false, { error: String(error?.stack ?? error) }, 'INSTRUMENTATION'); }
}
async function publishOk(id, def) {
  const p = await t.publish(def);
  r.raw(`${id}-publish`, { status: p.published?.status, body: p.ok ? undefined : p.published?.json ?? p.created?.json });
  if (!p.ok) r.check(`${id}-setup`, 'fixture publishes (setup)', false, p.published?.json ?? p.created?.json, 'SETUP');
  return p.ok ? p.loopId : undefined;
}
const lookalikes = (tag) => [
  ['real', () => new domain.ExpressionError(`QA486-EXT-${tag} real domain error`)],
  ['name', () => Object.assign(new Error(`QA486-EXT-${tag} name spoof`), { name: 'ExpressionError' })],
  ['code', () => ({ code: 'EXPRESSION_ERROR', message: `QA486-EXT-${tag} code spoof` })],
];

// ---- LLM decider callback ----
const routes = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
const llmLoop = (name) => ({
  name,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'd', kind: 'decision', label: 'D', config: { kind: 'llm', instructions: 'Pick.', harness: 'codex', model: { mode: 'inherit' }, effort: { mode: 'inherit' }, routes } },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"ok"' } },
  ],
  edges: [{ id: 'e0', from: { node: 'start', port: 'out' }, to: { node: 'd' } }, { id: 'e1', from: { node: 'd', port: 'a' }, to: { node: 'done' } }, { id: 'e2', from: { node: 'd', port: 'b' }, to: { node: 'done' } }],
});
for (const [k, make] of lookalikes('LLM')) {
  await scenario(`EXT-LLM-${k}`, async () => {
    const loop = await publishOk(`EXT-LLM-${k}`, llmLoop(`extllm ${k}`));
    if (!loop) return;
    t.decider.failNext.push(make());
    const res = await t.run(loop);
    const f = res.snapshot.failure;
    r.check(`EXT-LLM-${k}`, 'LLM decider callback rejection: provider/internal path (not authored EXPRESSION_ERROR), no boundary, marker absent', f && f.code !== 'EXPRESSION_ERROR' && !f.details?.boundary && containsAny(f, ['QA486-EXT']).length === 0, { failure: f }, 'SCRIPTED');
  });
}

// ---- Structured coerce in an inference input transform ----
for (const [k, make] of lookalikes('COERCE')) {
  await scenario(`EXT-COERCE-${k}`, async () => {
    H().reset();
    const loop = await publishOk(`EXT-COERCE-${k}`, chain(`extcoerce ${k}`, [
      { id: 'm', kind: 'mutate', label: 'm', config: { operations: [{ op: 'set', path: '/vars/raw', value: { kind: 'literal', value: 'not-an-object' } }] } },
      { id: 'inf', kind: 'inference', label: 'Inf', config: { harness: 'codex', prompt: { template: 'Q' }, input: [{ op: 'coerce', source: '/vars/raw', jsonSchema: { type: 'object', required: ['a'] }, target: '/vars/obj', repair: { enabled: true, maxAttempts: 1 } }] } },
    ]));
    if (!loop) return;
    const c0 = t.structured.calls.length;
    t.structured.failNext.push(make());
    const res = await t.run(loop);
    const f = res.snapshot.failure;
    const evs = await t.events(res.id);
    r.check(`EXT-COERCE-${k}`, 'structured coerce rejection during input prep: not an authored inference.input fault; marker absent; no main harness turn', t.structured.calls.length - c0 >= 1 && f && f.details?.boundary !== 'inference.input' && containsAny(f, ['QA486-EXT']).length === 0 && H().counters.starts === 0 && countType(evs, 'harness.turn') === 0, { failure: f, structuredCalls: t.structured.calls.length - c0 }, 'SCRIPTED');
  });
}

// ---- B17 positive control: real canonical system-chat trim/fit success ----
await scenario('B17-pos', async () => {
  H().reset();
  H().contextWindowImpl = () => Promise.resolve({ contextTokens: 1000, outputReserveTokens: 100, profile: 'qa-window', fits: (prompt) => !prompt.includes('QA-OLDEST-PAIR') });
  H().script({ kind: 'ok', finalText: 'chat reply' });
  const def = domain.createSystemChatDefinition({ name: 'qa b17 chat', harness: 'codex' });
  const loop = await publishOk('B17-pos', def);
  if (!loop) return;
  const input = { protocol: 'graphgoblin.chat.v1', conversationId: '01M7ZG0000000000000000QA17', requestId: randomUUID(), turn: 3, history: [{ role: 'user', text: 'QA-OLDEST-PAIR user' }, { role: 'assistant', text: 'QA-OLDEST-PAIR assistant' }, { role: 'user', text: 'recent user text' }, { role: 'assistant', text: 'recent assistant text' }], input: { kind: 'text', text: 'current message' } };
  const res = await t.run(loop, input);
  const evs = await t.events(res.id);
  const turn = evs.find((e) => e.type === 'harness.turn');
  const call = H().calls.at(-1);
  r.check('B17-pos', 'canonical rerender trims the oldest history pair to fit: one start whose prompt omits the oldest pair and keeps the recent pair; turn context retained 1/omitted 1; succeeded', res.snapshot.status === 'succeeded' && H().counters.starts === 1 && call?.prompt && !call.prompt.includes('QA-OLDEST-PAIR') && call.prompt.includes('recent user text') && turn?.context?.retainedHistoryPairs === 1 && turn?.context?.omittedHistoryPairs === 1, { status: res.snapshot.status, failure: res.snapshot.failure, context: turn?.context, cw: H().counters.contextWindow, promptHasRecent: call?.prompt?.includes('recent user text') }, 'PUBLIC-API+SCRIPTED');
  H().contextWindowImpl = undefined;
});

writeFileSync(join(OUT, 'd4b.logger.json'), JSON.stringify(t.logger.lines, null, 1));
const shut = await t.shutdown();
r.check('CLEANUP', 'authenticated drain accepted; port refuses', shut.drainStatus === 202 && shut.portRefused === true, shut, 'CLEANUP');
r.finish({ driverPid: process.pid, apiPort: 5878, dataDir: t.dataDir });
process.exit(0);
