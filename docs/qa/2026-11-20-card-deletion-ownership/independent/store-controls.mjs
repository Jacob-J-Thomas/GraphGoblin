import fs from'node:fs/promises';import path from'node:path';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';
const[lane,root]=process.argv.slice(2),url=name=>pathToFileURL(path.join(lane,'apps/web/src/editor',name)).href;
const{useEditorStore}=await import(url('store.ts')),{rowConnections}=await import(url('decision-route-edges.ts')),{validateDraft}=await import(url('model.ts'));
const capture=JSON.parse(await fs.readFile(path.join(root,'replay-inputs/prior-live-collision.json'),'utf8')),state=()=>useEditorStore.getState(),copy=value=>structuredClone(value),results=[];
for(const scenario of ['restored-delete','fresh-delete','unique-delete','both-owned-delete','description-control','target-rename']){
 const definition=copy(capture.definition),restored=scenario==='restored-delete';
 if(!restored)definition.nodes.find(n=>n.id==='pick').config.routes[1].id=scenario==='both-owned-delete'?'no':'affirm';
 if(scenario==='unique-delete')definition.edges[2].id='e2';
 state().load(scenario,definition,restored?{dirty:true,deviceSaved:true,decisionRoutes:copy(capture.decisionRoutes)}:undefined);
 const loaded={definition:copy(state().definition),decisionRoutes:copy(state().decisionRoutes)};
 if(restored){
  const config=state().definition.nodes.find(n=>n.id==='pick').config;
  state().updateNode('pick',{config:{...config,routes:config.routes.map((r,i)=>i===1?{...r,id:'affirm'}:r)}},{path:'routes.1.id',kind:'typing',id:117});assert.deepEqual(state().definition.edges,definition.edges);
 }
 const before={definition:copy(state().definition),decisionRoutes:copy(state().decisionRoutes),rowConnections:[0,1,2].map(i=>copy(rowConnections(state().definition,state().decisionRoutes,'pick',i)))},expected=copy(before.definition);
 if(scenario.endsWith('-delete')){expected.nodes=expected.nodes.filter(n=>n.id!=='done');expected.edges=expected.edges.filter(e=>e.from.node!=='done'&&e.to.node!=='done');state().removeNode('done');}
 else if(scenario==='description-control'){expected.description='Unrelated topology QA description';state().updateMeta({description:expected.description});}
 else{expected.nodes=expected.nodes.map(n=>n.id==='done'?{...n,id:'completed'}:n);expected.edges=expected.edges.map(e=>({...e,from:e.from.node==='done'?{...e.from,node:'completed'}:e.from,to:e.to.node==='done'?{...e.to,node:'completed'}:e.to}));assert.equal(state().renameNode('done','completed'),undefined);}
 const after={definition:copy(state().definition),decisionRoutes:copy(state().decisionRoutes),rowConnections:[0,1,2].map(i=>copy(rowConnections(state().definition,state().decisionRoutes,'pick',i))),issues:validateDraft(state().definition).issues};assert.deepEqual(after.definition,expected);
 if(scenario.endsWith('-delete')){assert.deepEqual(after.rowConnections[0],[]);assert.deepEqual(after.rowConnections[2],[]);assert.deepEqual(after.rowConnections[1],scenario==='both-owned-delete'?[before.definition.edges[2]]:[]);}
 state().undo();assert.deepEqual(state().definition,before.definition);assert.deepEqual(state().decisionRoutes,before.decisionRoutes);state().redo();assert.deepEqual(state().definition,after.definition);assert.deepEqual(state().decisionRoutes,after.decisionRoutes);
 results.push({scenario,status:'pass',loaded,before,expected,after,exactUndo:true,exactRedo:true});state().reset();
}
await fs.writeFile(path.join(root,'records/store-controls.json'),JSON.stringify({status:'pass',cases:results},null,2));console.log(JSON.stringify({status:'pass',cases:results.length}));
