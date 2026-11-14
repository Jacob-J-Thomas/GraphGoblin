import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { evaluateExpression, validateJson } = await import(pathToFileURL(join(process.argv[2],'packages/domain/dist/index.js')));
const cases=[];
async function check(name, test) {
 try{cases.push({name,status:'pass',details:await test()});}
 catch(e){cases.push({name,status:'fail',message:String(e),stack:e.stack});}
}
function pending(){let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};}
await check('independent concurrent depth budgets and bindings through public evaluator',async()=>{
 const source='($gate(); $counter := function($n) {$n=0 ? $tag : [$counter($n-1)]}; $counter(6))';
 const entered=pending(), release=pending();
 const a=evaluateExpression(source,{}, {maxDepth:9, bindings:{gate:()=>{entered.resolve();return release.promise;},tag:'strict'}});
 const observedA=a.then(value=>({value}),error=>({error:String(error)}));
 await entered.promise;
 const b=await evaluateExpression(source,{}, {maxDepth:100, bindings:{gate:()=>0,tag:'loose'}});
 release.resolve();
 const observed=await observedA;
 assert.match(observed.error??'', /max depth 9/);
 assert.deepEqual(b,['loose']);
 return {strict:observed,loose:b};
});
await check('real asynchronous interleave isolates deadline and now/millis',async()=>{
 const source='($before := $millis(); $iso := $now(); $gate(); {"tag":$tag,"before":$before,"after":$millis(),"isoBefore":$iso,"isoAfter":$now()})';
 const starts=[pending(),pending(),pending()], releases=[pending(),pending(),pending()];
 const budgets=[25,5000,5000];
 const runs=[];
 for(let i=0;i<3;i++){
  runs.push(evaluateExpression(source,{}, {timeoutMs:budgets[i],bindings:{tag:'invocation-'+i,gate:()=>{starts[i].resolve();return releases[i].promise;}}}).then(value=>({value}),error=>({error:String(error)})));
  await starts[i].promise;
  await wait(50);
 }
 releases[2].resolve(); releases[0].resolve(); releases[1].resolve();
 const observed=await Promise.all(runs);
 assert.match(observed[0].error??'', /exceeded 25ms/);
 const one=observed[1].value,two=observed[2].value;
 for(const [i,v] of [[1,one],[2,two]]){
  assert.equal(v.tag,'invocation-'+i);
  assert.equal(v.before,v.after);
  assert.equal(v.isoBefore,v.isoAfter);
  assert.equal(Date.parse(v.isoBefore),v.before);
 }
 assert(one.before<two.before);
 return observed;
});
await check('dynamic eval inherits depth and cycle limits and permits legal sibling width',async()=>{
 const wideSource=JSON.stringify(Array.from({length:333},(_,n)=>({n,valid:n%2===0})));
 const result=await evaluateExpression('$eval(src)',{src:wideSource},{maxDepth:11});
 assert.equal(result.length,333);
 assert.deepEqual({...result.at(-1)},{n:332,valid:true});
 await assert.rejects(evaluateExpression('$eval(s)',{s:'$eval(s)'},{maxDepth:14}), /max depth 14/);
 const nested='['.repeat(35)+'3'+']'.repeat(35);
 await assert.rejects(evaluateExpression('$eval(src)',{src:nested},{maxDepth:18}), /max depth 18/);
 return {dynamicLength:result.length,cycleLimit:14,nestingLimit:18};
});
await check('independent round-trip cache mutation and eviction with nested enum objects',async()=>{
 const input=(type)=>({nested:{type}});
 const schema={$id:'https://scope.test/mutable',definitions:{target:{$id:'nested-rule',enum:[input('original')]}},$ref:'nested-rule'};
 const original=structuredClone(schema);
 assert.equal(validateJson(schema,input('original')).ok,true);
 schema.definitions.target.enum[0].nested.type='edited';
 assert.equal(validateJson(schema,input('edited')).ok,true);
 assert.equal(validateJson(schema,input('original')).ok,false);
 assert.equal(validateJson(original,input('edited')).ok,false);
 assert.equal(validateJson(original,input('original')).ok,true);
 for(let i=0;i<258;i++) assert.equal(validateJson({$id:'https://scope.test/evict/'+i, const:i},i).ok,true);
 assert.equal(validateJson(original,input('original')).ok,true);
 assert.equal(validateJson(original,input('edited')).ok,false);
 return {mutated:'nested enum',rotatedDistinctSchemas:258};
});
await check('JSON Pointer escaping and independent nested-ID registries',async()=>{
 const defs=(type)=>({$id:'https://scope.test/shared',definitions:{'a/b~c':{$id:'member',type}},type:'object',required:['x/y'],properties:{'x/y':{$ref:'#/definitions/a~1b~0c'}}});
 for(const [schema,valid,invalid] of [[defs('string'),'abc',9],[defs('integer'),9,'abc']]){
  assert.equal(validateJson(schema,{'x/y':valid}).ok,true);
  assert.deepEqual(validateJson(schema,{'x/y':invalid}).issues,[{path:['x/y'],message:'must be '+(typeof valid==='string'?'string':'integer')}]);
 }
 const external=validateJson({$ref:'https://scope.test/shared'}, {});
 assert.equal(external.ok,false);
 assert.match(external.errors[0],/can't resolve reference https:\/\/scope\.test\/shared/);
 return external;
});
console.log(JSON.stringify(cases,null,2));
if(cases.some(t=>t.status!=='pass'))process.exitCode=1;

