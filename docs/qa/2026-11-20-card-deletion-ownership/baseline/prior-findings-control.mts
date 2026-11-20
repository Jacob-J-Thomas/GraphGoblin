import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2]);
const locate = (name: string) => pathToFileURL(path.join(root, 'apps/web/src/editor', name)).href;
const { useEditorStore } = await import(locate('store.ts'));
const { rowConnections } = await import(locate('decision-route-edges.ts'));
const source = JSON.parse(readFileSync(path.join(root, 'docs/qa/2026-11-19-decision-row-ownership/independent/replay-inputs/prior-live-collision.json'), 'utf8'));
const s = () => useEditorStore.getState();
const closed = () => s().closeStep();
const pick = () => s().definition.nodes.find((node: {id:string})=>node.id==='pick').config;
const changeId = (idx: number, id: string) => {
  const config=structuredClone(pick());
  config.routes[idx].id=id;
  s().updateNode('pick',{config},{path:`routes.${idx}.id`,kind:'typing',id:90+idx});
  closed();
};
const removeSecond = () => {
  const config=structuredClone(pick());
  config.routes.splice(1,1);
  s().updateNode('pick',{config},{path:'routes',kind:'commit',id:92,collection:{type:'remove',index:1}});
  closed();
};
const history = (before: unknown, after: unknown) => {
  s().undo();
  assert.deepStrictEqual(s().definition,before);
  s().redo();
  assert.deepStrictEqual(s().definition,after);
};
const results=[];
for (const family of ['fresh-shared','fresh-unique','archived']) {
  for (const action of family==='archived'?['rename','remove']:['rename','remove','direct']) {
    const def=structuredClone(source.definition);
    if(family==='fresh-unique') def.edges[2].id='e2';
    if(family!=='archived') def.nodes[1].config.routes[1].id='no';
    s().load('finite-controls',def,family==='archived'?{dirty:true,deviceSaved:true,decisionRoutes:structuredClone(source.decisionRoutes)}:{});
    if(family!=='archived' && action!=='direct') {changeId(1,'yes');assert.deepStrictEqual(s().definition.edges,def.edges);}
    const before=structuredClone(s().definition);
    const preview=rowConnections(s().definition,s().decisionRoutes,'pick',1);
    assert.deepStrictEqual(preview,family==='archived'?[]:[def.edges[2]]);
    if(action==='remove') removeSecond(); else changeId(1,'affirm');
    const expected=structuredClone(def.edges);
    if(family!=='archived') {
      if(action==='remove') expected.splice(2,1); else expected[2].from.port='affirm';
    }
    assert.deepStrictEqual(s().definition.edges,expected);
    history(before,structuredClone(s().definition));
    if(family==='archived') {
      const nextBefore=structuredClone(s().definition);
      changeId(0,'accepted');
      expected[1].from.port='accepted';
      assert.deepStrictEqual(s().definition.edges,expected);
      history(nextBefore,structuredClone(s().definition));
    }
    results.push({family,action,secondRowRemovalPreview:preview,expectedRecords:expected,exactHistory:true});
    s().reset();
  }
}
console.log(JSON.stringify(results,null,2));
