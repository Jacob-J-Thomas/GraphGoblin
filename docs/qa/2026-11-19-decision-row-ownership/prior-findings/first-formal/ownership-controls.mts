import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(process.argv[2] ?? process.cwd());
const source = (file: string) => pathToFileURL(path.join(repo, 'apps/web/src/editor', file)).href;
const { useEditorStore } = await import(source('store.ts'));
const { rowConnections } = await import(source('decision-route-edges.ts'));

const store = () => useEditorStore.getState();
const routes = (...ids: string[]) => ({ kind: 'expression', jsonata: '"yes"', routes: ids.map(id => ({ id, label: id })) });
const fixture = (unique: boolean) => ({
  schemaVersion: 4, name: 'Independent ownership controls',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    { id: 'pick', kind: 'decision', label: 'Pick', config: routes('yes', 'no', 'maybe') },
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
    { id: 'other', kind: 'exit', label: 'Other', config: {} },
  ],
  edges: [
    { id: 's1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
    { id: 'e1', from: { node: 'pick', port: 'yes' }, to: { node: 'done' }, ui: { route: [400, 200, 500] } },
    { id: unique ? 'e2' : 'e1', from: { node: 'pick', port: 'no' }, to: { node: 'other' }, ui: { route: [650] } },
    { id: 'm1', from: { node: 'pick', port: 'maybe' }, to: { node: 'done' } },
  ],
});
const typing = { path: 'routes.1.id', kind: 'typing', id: 481 };
const results = [];
for (const unique of [false, true]) {
  for (const action of ['rename-after-collision', 'remove-after-collision', 'direct-rename']) {
    const original = fixture(unique);
    store().load('probe', original);
    if (action !== 'direct-rename') {
      store().updateNode('pick', { config: routes('yes', 'yes', 'maybe') }, typing);
      assert.deepEqual(store().definition!.edges, original.edges);
    }
    const preview = rowConnections(store().definition!, store().decisionRoutes, 'pick', 1);
    if (action === 'remove-after-collision') {
      store().updateNode('pick', { config: routes('yes', 'maybe') }, {
        path: 'routes', kind: 'commit', id: 482, collection: { type: 'remove', index: 1 },
      });
    } else {
      store().updateNode('pick', { config: routes('yes', 'affirm', 'maybe') }, typing);
    }
    const after = store().definition!;
    const unrelated = after.edges.find(edge => edge.to.node === 'done' && edge.id === 'e1');
    const wrongRecordChanged = JSON.stringify(unrelated) !== JSON.stringify(original.edges[1]);
    const intended = after.edges.find(edge => edge.to.node === 'other');
    const result = { uniqueEdgeIds: unique, action, preview: preview.map(edge => ({ port: edge.from.port, to: edge.to.node })), wrongRecordChanged, unrelated: unrelated ?? null, intended: intended ?? null };
    if (unique || action === 'direct-rename') assert.equal(wrongRecordChanged, false);
    else assert.equal(wrongRecordChanged, true);
    store().undo();
    if (action === 'remove-after-collision') store().undo();
    assert.deepEqual(store().definition, original);
    results.push(result);
    store().reset();
  }
}
console.log(JSON.stringify({ result: 'confirmed', cases: results }, null, 2));
