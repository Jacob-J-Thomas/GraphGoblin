import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import { fixture } from './fixtures.mjs';

const lane = process.argv[2], evidence = process.argv[3];
await mkdir(evidence, { recursive: true });
const { useEditorStore } = await import(pathToFileURL(path.join(lane, 'apps/web/src/editor/store.ts')));
const { LoopDefinitionSchema } = await import(pathToFileURL(path.join(lane, 'packages/contracts/dist/index.js')));
const observations = [];
const state = () => useEditorStore.getState();
const snapshot = () => structuredClone({ definition: state().definition, decisionRoutes: state().decisionRoutes, revision: state().revision, historyEpoch: state().historyEpoch, past: state().past, future: state().future, connectionError: state().connectionError });
function run(name, input, action, expected) {
  const definition = LoopDefinitionSchema.parse(input);
  state().load('01KAQA00000000000000000481', definition);
  const before = snapshot();
  const returned = action();
  const after = snapshot();
  let undo, redo;
  if (after.revision !== before.revision) {
    state().undo(); undo = snapshot();
    state().redo(); redo = snapshot();
  }
  const correct = expected(before, after, returned);
  const exactUndo = !undo || same(undo.definition, before.definition) && same(undo.decisionRoutes, before.decisionRoutes);
  const exactRedo = !redo || same(redo.definition, after.definition) && same(redo.decisionRoutes, after.decisionRoutes);
  observations.push({ name, result: correct && exactUndo && exactRedo ? 'pass' : 'fail', correct, exactUndo, exactRedo, before, after, undo, redo, returned });
}
for (const mode of ['duplicate', 'two-rows', 'unique']) {
  run(`${mode}: unrelated description`, fixture('store QA', mode), () => state().updateMeta({ description: 'An unrelated real edit' }), (b,a) => same(a.definition.edges,b.definition.edges));
  run(`${mode}: remove unique c1`, fixture('store QA', mode), () => state().removeEdge('c1'), (b,a) => same(a.definition.edges,b.definition.edges.filter(e => e.id !== 'c1')));
  run(`${mode}: reset route e1`, fixture('store QA', mode), () => state().setEdgeRoute('e1', undefined), (b,a) => mode === 'unique' ? same(a.definition.edges, b.definition.edges.map((e,i) => { if(i) return e; const {ui,...rest} = e; return rest; })) : same(a.definition,b.definition) && a.revision === b.revision && Boolean(a.connectionError));
  run(`${mode}: set route e1`, fixture('store QA', mode), () => state().setEdgeRoute('e1', [280,470,700]), (b,a) => mode === 'unique' ? same(a.definition.edges,b.definition.edges.map((e,i) => i ? e : {...e,ui:{route:[280,470,700]}})) : same(a.definition,b.definition) && a.revision === b.revision && Boolean(a.connectionError));
  run(`${mode}: missing route ID`, fixture('store QA', mode), () => state().setEdgeRoute('absent-edge', [333]), (b,a) => same(a,b));
  run(`${mode}: rename Decision yes ID`, fixture('store QA', mode), () => {
    const config = structuredClone(state().definition.nodes.find(n => n.id === 'pick').config);
    config.routes[0].id = 'accepted';
    state().updateNode('pick', { config }, { path:'routes.0.id', kind:'typing', id:81 });
  }, (b,a) => same(a.definition.edges, b.definition.edges.map((e,i) => i === 1 ? {...e,from:{...e.from,port:'accepted'}} : e)));
  run(`${mode}: remove Decision yes row`, fixture('store QA', mode), () => {
    const config = structuredClone(state().definition.nodes.find(n => n.id === 'pick').config);
    config.routes.splice(0,1);
    state().updateNode('pick', { config }, { path:'routes', kind:'commit', id:82, collection:{ type:'remove', index:0 } });
  }, (b,a) => same(a.definition.edges,b.definition.edges.filter((_,i) => i !== 1)));
}
await writeFile(path.join(evidence,'store-behavior-observations.json'), JSON.stringify(observations,null,2));
console.log(JSON.stringify({ cases:observations.length, passes:observations.filter(x=>x.result==='pass').length, failures:observations.filter(x=>x.result==='fail').map(x=>({name:x.name, correct:x.correct, exactUndo:x.exactUndo, exactRedo:x.exactRedo})) }));
