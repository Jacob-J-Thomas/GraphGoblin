import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { loopBackEdgeIds } from 'file:///C:/Users/98jak/.codex/worktrees/gg-20261107-loopback/GraphGoblin/apps/web/src/editor/loop-back-edges.ts';

// Independent oracle: enumerate simple paths to each source and intersect the visited nodes.
// Any path witnessing a first visit has a simple-path witness, so cycles need no unbounded walk.
const nodes = [
  { id: 't', kind: 'trigger', label: 'Entry', config: { type: 'manual' } },
  ...['a', 'b', 'c'].map(id => ({ id, kind: 'decision', label: id, config: {
    kind: 'expression', jsonata: '"a"', routes: ['a', 'b', 'c'].map(port => ({ id: port, label: port })),
  } })),
];
const possible = ['t', 'a', 'b', 'c'].flatMap(from => ['a', 'b', 'c'].map(to => ({
  id: `${from}-${to}`, from: { node: from, port: from === 't' ? 'out' : to }, to: { node: to },
})));
let edgeComparisons = 0;
for (let mask = 0; mask < 2 ** possible.length; mask++) {
  const edges = possible.filter((_, bit) => mask & (1 << bit));
  const histories = new Map(['t', 'a', 'b', 'c'].map(id => [id, []]));
  function enumerate(id, path) {
    const next = [...path, id];
    histories.get(id).push(next);
    for (const edge of edges)
      if (edge.from.node === id && !next.includes(edge.to.node)) enumerate(edge.to.node, next);
  }
  enumerate('t', []);
  const expected = edges.filter(edge => edge.from.node === edge.to.node ||
    (histories.get(edge.from.node).length > 0 && histories.get(edge.from.node).every(path => path.includes(edge.to.node))))
    .map(edge => edge.id).sort();
  const actual = [...loopBackEdgeIds({ nodes, edges })].sort();
  assert.deepEqual(actual, expected, `graph mask=${mask}`);
  edgeComparisons += edges.length;
}
const result = { result: 'pass', graphs: 2 ** possible.length, edgeComparisons, method: 'all simple entry-to-source paths', time: new Date().toISOString() };
writeFileSync('C:/Users/98jak/graphgoblin-qa/2026-11-07-loopback/independent-graph-oracle.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
