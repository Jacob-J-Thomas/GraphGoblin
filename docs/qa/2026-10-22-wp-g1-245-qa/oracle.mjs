// Independent RFC 6902 application for captured evidence; deliberately no domain replay import.
import assert from 'node:assert/strict';
const clone = (x) => structuredClone(x);
const keys = (path) =>
  path === ''
    ? []
    : path
        .slice(1)
        .split('/')
        .map((x) => x.replaceAll('~1', '/').replaceAll('~0', '~'));
export function at(doc, path) {
  return keys(path).reduce((v, k) => v?.[k], doc);
}
function edit(doc, path, op, value) {
  const parts = keys(path);
  if (!parts.length) return op === 'remove' ? undefined : clone(value);
  const key = parts.pop();
  const parent = parts.reduce((v, k) => {
    assert.ok(v && k in v, path);
    return v[k];
  }, doc);
  assert.ok(parent !== undefined, path);
  if (Array.isArray(parent)) {
    const index = key === '-' ? parent.length : Number(key);
    if (op === 'add') parent.splice(index, 0, clone(value));
    else if (op === 'remove') parent.splice(index, 1);
    else {
      assert.ok(index < parent.length, path);
      parent[index] = clone(value);
    }
  } else if (op === 'remove') {
    assert.ok(key in parent, path);
    delete parent[key];
  } else {
    if (op === 'replace') assert.ok(key in parent, path);
    parent[key] = clone(value);
  }
  return doc;
}
export function independentStates(seed, events) {
  let state = clone(seed);
  const states = [];
  for (const e of events) {
    if (e.type === 'node.started')
      state.counters.nodeVisits[e.nodeId] = (state.counters.nodeVisits[e.nodeId] ?? 0) + 1;
    if (e.type === 'decision.made' && e.gate) state.gates[e.nodeId] = { passes: e.gate.passes };
    if (e.type === 'iteration.incremented') state.run.iteration = e.to;
    if (e.type === 'node.finished')
      for (const p of e.patch) {
        if (p.op === 'test') assert.deepEqual(at(state, p.path), p.value);
        else if (p.op === 'copy' || p.op === 'move') {
          const value = clone(at(state, p.from));
          if (p.op === 'move') state = edit(state, p.from, 'remove');
          state = edit(state, p.path, 'add', value);
        } else state = edit(state, p.path, p.op, p.value);
      }
    states.push({ seq: e.seq, type: e.type, thread: clone(state) });
  }
  return states;
}
