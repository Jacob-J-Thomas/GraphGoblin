import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(process.argv[2] ?? process.cwd());
const source = (file: string) => pathToFileURL(path.join(repo, 'apps/web/src/editor', file)).href;
const { useEditorStore } = await import(source('store.ts'));
const { rowConnections } = await import(source('decision-route-edges.ts'));

const store = () => useEditorStore.getState();
const routes = (...ids: string[]) => ({ kind: 'expression', jsonata: '"yes"', routes: ids.map(id => ({ id, label: id })) });
const original = {
  schemaVersion: 4,
  name: 'Independent collision probe',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'pick', kind: 'decision', label: 'Pick', config: routes('yes', 'no', 'maybe') },
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
    { id: 'other', kind: 'exit', label: 'Other', config: {} },
  ],
  edges: [
    { id: 's1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
    { id: 'e1', from: { node: 'pick', port: 'yes' }, to: { node: 'done' }, ui: { route: [400, 200, 500] } },
    { id: 'e1', from: { node: 'pick', port: 'no' }, to: { node: 'other' }, ui: { route: [650] } },
    { id: 'm1', from: { node: 'pick', port: 'maybe' }, to: { node: 'done' } },
  ],
};
store().load('probe', original);
const typing = { path: 'routes.1.id', kind: 'typing', id: 481 };
store().updateNode('pick', { config: routes('yes', 'yes', 'maybe') }, typing);
assert.deepEqual(store().definition!.edges, original.edges);
const collision = store().definition!;
const collisionOwnership = store().decisionRoutes;
const claimedRemoval = rowConnections(collision, store().decisionRoutes, 'pick', 1);
store().updateNode('pick', { config: routes('yes', 'affirm', 'maybe') }, typing);
const after = store().definition!;
console.log(JSON.stringify({
  originalEdges: original.edges,
  collisionOwnership,
  collisionRemovalPreview: claimedRemoval,
  afterEdges: after.edges,
  unrelatedRecordPreserved: JSON.stringify(after.edges[1]) === JSON.stringify(original.edges[1]),
  intendedRecordPort: after.edges[2]!.from.port,
}, null, 2));
store().reset();
