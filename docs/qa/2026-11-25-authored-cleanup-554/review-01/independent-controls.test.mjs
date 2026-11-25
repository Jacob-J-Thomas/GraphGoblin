import fs from 'node:fs';
import { planMutation, MutationError, PatchError, TemplateError, ExpressionError } from 'G:/ggq/gg-fu-authored-cleanup-20261124/GraphGoblin/packages/domain/src/index.ts';
import { MutationOperationSchema } from 'G:/ggq/gg-fu-authored-cleanup-20261124/GraphGoblin/packages/contracts/src/index.ts';
import { sampleThread } from 'G:/ggq/gg-fu-authored-cleanup-20261124/GraphGoblin/packages/contracts/src/testing/index.ts';
const root = 'G:/ggq/gg-fu-authored-cleanup-20261124/GraphGoblin/';
const ctx = {nodeId:'review', newId:()=> 'review-message', now:()=> '2026-11-25T02:00:00.000Z'};
const schema = {type:'object', properties:{ok:{type:'boolean'}}, required:['ok']};
const coerce = MutationOperationSchema.parse({op:'coerce',source:'/vars/value',jsonSchema:schema,target:'/vars/result'});
const errors = [new Error('external'), new MutationError('external'), new PatchError('external'), new TemplateError('external'), new ExpressionError('external'), null, 11];
it.each(errors.map((error,index)=>[index,error]))('validation throw %i preserves identity or ordinary mapping without authored attribution', async (_,error)=> {
  const thread=sampleThread();
  thread.vars.value=Object.defineProperty({},'ok',{enumerable:true,get(){throw error;}});
  const fact=vi.fn(()=>new Error('wrong authored attribution'));
  const ordinaryMarker=new Error('ordinary mapper result');
  const ordinary=vi.fn(()=>ordinaryMarker);
  await expect(planMutation(thread,coerce,ctx,8,undefined,fact)).rejects.toBe(error);
  await expect(planMutation(thread,coerce,ctx,8,ordinary,fact)).rejects.toBe(ordinaryMarker);
  expect(ordinary.mock.calls).toEqual([[error,8,'coerce']]);
  expect(fact).not.toHaveBeenCalled();
});
it('continues to prefer authored facts for a supported invalid mutable target', async ()=> {
  const ordinary=vi.fn(); const marker=new Error('fact marker'); const fact=vi.fn(()=>marker);
  const invalidTarget=MutationOperationSchema.parse({...coerce,target:'/run/id'});
  await expect(planMutation(sampleThread(),invalidTarget,ctx,2,ordinary,fact)).rejects.toBe(marker);
  expect(fact.mock.calls).toEqual([[{kind:'target'},2,'coerce']]); expect(ordinary).not.toHaveBeenCalled();
});
it('keeps valid JSON data on the normal validation path', async ()=> {
  const thread=sampleThread(); thread.vars.value={ok:true};
  const ordinary=vi.fn(); const fact=vi.fn();
  expect(await planMutation(thread,coerce,ctx,0,ordinary,fact)).toEqual({kind:'patch',patch:[{op:'add',path:'/vars/result',value:{ok:true}}]});
  thread.vars.value={ok:'wrong'};
  expect(await planMutation(thread,coerce,ctx,0,ordinary,fact)).toMatchObject({kind:'repair',request:{value:{ok:'wrong'}}});
  expect(ordinary).not.toHaveBeenCalled(); expect(fact).not.toHaveBeenCalled();
});
it('matches every closed documented boundary to the fields map exactly once', ()=> {
  const source=fs.readFileSync(root+'packages/engine/src/authored-failure.ts','utf8');
  const map=source.split('const fields = {')[1].split('} as const;')[0];
  const fields=[...map.matchAll(/'([^']+)':/g)].map(m=>m[1]).sort();
  const doc=fs.readFileSync(root+'docs/05-execution-engine.md','utf8').split('### Authored boundary identifiers')[1].split('### Deliberate script recovery')[0];
  const rows=doc.split(/\r?\n/).filter(line=>line.startsWith('| `') && !line.startsWith('| `details.boundary`'));
  const documented=rows.flatMap(line=>[...line.split('|')[1].matchAll(/`([^`]+)`/g)].map(m=>m[1])).sort();
  expect(fields).toHaveLength(27); expect(documented).toEqual(fields);
});
