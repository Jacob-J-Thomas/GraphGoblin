// Approved A1/A2/A5 shapes. This module performs no I/O.
const literal = (path, value) => ({ op: 'set', path, value: { kind: 'literal', value } });
const expression = (path, jsonata) => ({ op: 'set', path, value: { kind: 'expression', jsonata } });
const template = (path, source) => ({ op: 'set', path, value: { kind: 'template', template: source } });
const before = literal('/vars/qaBefore', true);
const after = literal('/vars/qaAfter', true);
const seed = literal('/vars/qaRaw', { ok: 'yes' });
const value = (operand) => literal('/vars/qaValue', operand);
const numeric = expression('/vars/qaAnswer', '$number(vars.qaValue)');
const scalar = literal('/vars/qaScalar', 7);
const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
const coerce = (repair = {}, target = '/vars/qaClean') => ({
  op: 'coerce', source: '/vars/qaRaw', target, jsonSchema: schema,
  repair: { enabled: true, maxAttempts: 1, onFailure: 'fail-run', ...repair },
});
const success = (entries) => ({
  status: 'succeeded',
  patch: entries.map(([key, value]) => ({ op: 'add', path: '/vars/' + key, value })),
  result: Object.fromEntries(entries),
});
const deterministic = (index, op, kind, cause) => ({
  status: 'failed', index, op, kind, cause,
});
const failed = (code, resumable) => ({ status: 'failed', code, resumable });
// Reuse the authored inputs from review-461/astra-audit/native-smoke.mjs:76.
const wideRows = Array.from({ length: 211 }, (_, i) => ({ i }));
// Distinct absolute-looking Windows paths injected only as strings from the fake port.
export const unexpectedRepairFault = {
  messagePath: 'C:/qa-381-private-message/synthetic-repair.js',
  stackPath: 'D:/qa-381-private-stack/synthetic-repair.js',
  markers: ['qa-381-private-message', 'qa-381-private-stack'],
};

export const cases = [
  { id: 'a1-explicit', tier: 'native', inspector: true, resume: 'rest',
    ops: [before, expression('/vars/qaAnswer', '$error("author-QA-381")'), after],
    expect: deterministic(1, 'set', 'expression', 'author-QA-381') },
  { id: 'a1-operand', tier: 'native', ops: [before, value('qa-381-not-a-number'), numeric, after],
    expect: deterministic(2, 'set', 'expression', 'Unable to cast value to a number') },
  { id: 'a1-patch', tier: 'native', resume: 'mcp',
    ops: [before, scalar, literal('/vars/qaScalar/leaf', 1), after],
    expect: deterministic(2, 'set', 'patch', 'traverses a non-container') },
  { id: 'a1-success', tier: 'native', ops: [before, value('42'), numeric, after],
    expect: success([['qaBefore', true], ['qaValue', '42'], ['qaAnswer', 42], ['qaAfter', true]]) },
  { id: 'a1-exit-depth', tier: 'native', inspector: true, resume: 'rest',
    exitReturn: '['.repeat(230) + '1' + ']'.repeat(230),
    expect: { ...failed('EXPRESSION_ERROR', false), exitDepth: true, cause: 'max depth 200' } },
  { id: 'a1-exit-width', tier: 'native', exitReturn: JSON.stringify(wideRows),
    expect: { status: 'succeeded', result: wideRows } },
  { id: 'a2-value-template', tier: 'native',
    ops: [before, template('/vars/qaAnswer', '{{ "qa-381-template" | append }}'), after],
    expect: deterministic(1, 'set', 'template', 'append expect 2 arguments') },
  { id: 'a2-repair-prompt', tier: 'composed', mode: 'no-call', calls: 0,
    ops: [before, seed, coerce({ prompt: '{{ "qa-381-prompt" | append }}' }), after],
    expect: deterministic(2, 'coerce', 'repair-template', 'append expect 2 arguments') },
  { id: 'a2-after-repair', tier: 'composed', mode: 'valid', calls: 1,
    ops: [before, seed, coerce(), expression('/vars/qaAnswer',
      'vars.qaClean.ok = true ? $error("author-QA-381-after-repair") : "unrepaired"'), after],
    expect: deterministic(3, 'set', 'expression', 'author-QA-381-after-repair') },
  { id: 'a2-repair-success', tier: 'composed', mode: 'valid', calls: 1,
    ops: [before, seed, coerce(), expression('/vars/qaAnswer', 'vars.qaClean.ok'), after],
    expect: success([['qaBefore', true], ['qaRaw', { ok: 'yes' }], ['qaClean', { ok: true }], ['qaAnswer', true], ['qaAfter', true]]) },
  { id: 'a2-provider-error', tier: 'composed', mode: 'provider-error', calls: 1, inspector: true, unexpectedRepair: true,
    ops: [before, seed, coerce(), after], expect: failed('INTERNAL_ERROR', true) },
  { id: 'a2-provider-template', tier: 'composed', mode: 'provider-template', calls: 1,
    ops: [before, seed, coerce(), after], expect: failed('INTERNAL_ERROR', true) },
  { id: 'a2-no-provider', tier: 'composed', mode: 'missing-port', calls: 0,
    ops: [before, seed, coerce(), after], expect: failed('DECIDER_UNAVAILABLE', true) },
  { id: 'a2-schema-mismatch', tier: 'composed', mode: 'invalid', calls: 1,
    ops: [before, seed, coerce(), after], expect: failed('OUTPUT_SCHEMA_MISMATCH', true) },
  { id: 'a2-continue-raw', tier: 'composed', mode: 'invalid', calls: 1,
    ops: [before, seed, coerce({ onFailure: 'continue-raw' }), after],
    expect: success([['qaBefore', true], ['qaRaw', { ok: 'yes' }], ['qaClean', { ok: 'yes' }], ['qaAfter', true]]) },
  { id: 'a2-repaired-target', tier: 'composed', mode: 'valid', calls: 1,
    ops: [before, seed, scalar, coerce({}, '/vars/qaScalar/leaf'), after],
    expect: deterministic(3, 'coerce', 'repair-patch', 'traverses a non-container') },
  { id: 'a2-raw-target', tier: 'composed', mode: 'invalid', calls: 1,
    ops: [before, seed, scalar, coerce({ onFailure: 'continue-raw' }, '/vars/qaScalar/leaf'), after],
    expect: deterministic(3, 'coerce', 'repair-patch', 'traverses a non-container') },
  { id: 'a2-final-thread', tier: 'native', ops: [before, literal('/vars', 7)],
    expect: failed('INTERNAL_ERROR', false) },
];

export const definition = ({ id, ops, exitReturn }) => ({
  schemaVersion: 4,
  name: 'QA 381 ' + id,
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    ...(ops ? [{ id: 'mut', kind: 'mutate', label: 'QA mutation', config: { operations: ops } }] : []),
    { id: 'done', kind: 'exit', label: 'Done',
      config: { outcome: 'success', returns: exitReturn ?? 'vars', destinations: [{ kind: 'caller' }] } },
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: ops ? 'mut' : 'done' } },
    ...(ops ? [{ id: 'e2', from: { node: 'mut', port: 'out' }, to: { node: 'done' } }] : []),
  ],
});
