import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const checkout = path.resolve(process.argv[2]);
const moduleUrl = (name: string) => pathToFileURL(path.join(checkout, 'apps/web/src/editor', name)).href;
const { useEditorStore } = await import(moduleUrl('store.ts'));
const { rowConnections } = await import(moduleUrl('decision-route-edges.ts'));
const { validateDraft } = await import(moduleUrl('model.ts'));
const packet = path.join(checkout, 'docs/qa/2026-11-19-decision-row-ownership/independent/replay-inputs/prior-live-collision.json');
const capture = JSON.parse(readFileSync(packet, 'utf8'));
const state = () => useEditorStore.getState();
const copy = (value: unknown) => structuredClone(value);
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second);
const routeIds = () => state().definition.nodes.find((node: any) => node.id === 'pick').config.routes.map((row: any) => row.id);
const ownership = () => state().decisionRoutes.pick.rows.map(({id, edgeIds}: any) => [id, edgeIds]);
const list = (index: number) => rowConnections(state().definition, state().decisionRoutes, 'pick', index);
const editing = (index: number, id: string) => {
  const cfg = state().definition.nodes.find((node: any) => node.id === 'pick').config;
  const routes = cfg.routes.map((item: any, j: number) => j === index ? {...item, id} : item);
  state().updateNode('pick', {config:{...cfg, routes}}, {path:`routes.${index}.id`, kind:'typing', id:116+index});
};
const results: any = {};
for (const scenario of ['restored', 'fresh-duplicate', 'fresh-unique', 'fresh-both-owned', 'fresh-duplicate-keep-target']) {
  let def = copy(capture.definition) as any;
  const routes = def.nodes.find((node: any) => node.id==='pick').config.routes;
  if (scenario === 'restored') {
    state().load('audit', def, {dirty:true, deviceSaved:true, decisionRoutes:copy(capture.decisionRoutes)});
    assert.deepStrictEqual(list(0), []);
    assert.deepStrictEqual(list(1), []);
    editing(1, 'affirm');
    assert.deepStrictEqual(state().definition.edges, def.edges);
  } else {
    routes[1].id = scenario === 'fresh-both-owned' ? 'no' : 'affirm';
    if (scenario === 'fresh-unique') def.edges[2].id = 'e2';
    state().load('audit', def);
  }
  const before = copy(state().definition) as any;
  const expectToRemain = before.edges.filter((edge: any) => edge.from.node !== 'done' && edge.to.node !== 'done');
  const details: any = {routeIds:routeIds(), initialOwnership:ownership(), beforeEdges:before.edges, initialCodes:validateDraft(before).issues.map((i: any) => i.code)};
  if (scenario === 'fresh-duplicate-keep-target') {
    state().updateMeta({description:'Unrelated content'});
    details.unrelatedDescriptionPreservedEveryEdge = same(before.edges, state().definition.edges);
    assert.equal(details.unrelatedDescriptionPreservedEveryEdge, true);
  } else {
    state().removeNode('done');
    const after = copy(state().definition) as any;
    details.expectedEdges = expectToRemain;
    details.actualEdges = after.edges;
    details.afterOwnership = ownership();
    details.survivorsPreserved = same(expectToRemain, after.edges);
    details.reviewYesAfterDelete = list(0);
    state().undo();
    details.exactUndo = same(before, state().definition);
    state().redo();
    details.exactRedo = same(after, state().definition);
    assert.equal(details.exactUndo, true);
    assert.equal(details.exactRedo, true);
    assert.equal(details.survivorsPreserved, ['fresh-unique', 'fresh-both-owned'].includes(scenario));
  }
  results[scenario]=details;
  state().reset();
}
console.log(JSON.stringify(results, null, 2));
