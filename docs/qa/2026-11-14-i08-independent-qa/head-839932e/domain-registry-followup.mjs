import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { validateJson } = await import(pathToFileURL(join(process.argv[2],'packages/domain/dist/index.js')));
const cases=[];
function check(name, action){
 const begin=performance.now();
 try{cases.push({name,status:'pass',elapsedMs:Math.round(performance.now()-begin),details:action()});}
 catch(e){cases.push({name,status:'fail',message:String(e),stack:e.stack});}
}
function checkCase(name, action){
 const begin=performance.now();
 try{
  const details=action();
  cases.push({name,status:'pass',elapsedMs:Math.round(performance.now()-begin),details});
 } catch(e){ cases.push({name,status:'fail',message:String(e),stack:e.stack});}
}
const rootId='https://cleanup.scope.test/v2/root.json';
const embedded='https://cleanup.scope.test/v2/embedded.json';
const leafId='https://cleanup.scope.test/v2/second.json';
const scoped=(type)=>({
 $schema:'http://json-schema.org/schema',
 $id:rootId,
 definitions:{
  embedded:{$id:'embedded.json',type:'array',items:{$ref:'second.json'}},
  next:{$id:'second.json',type},
 },
 properties:{payload:{$ref:'embedded.json'}},
 required:['payload'],
});
checkCase('registry cleanup also isolates nested IDs and retains references in cached validators',()=>{
 const string=scoped('string'), integer=scoped('integer');
 assert.equal(validateJson(string,{payload:['word']}).ok,true);
 assert.equal(validateJson(integer,{payload:[12]}).ok,true);
 for(const externalId of [rootId,embedded,leafId]){
  const consumer={$id:'https://cleanup.scope.test/consumer/'+encodeURIComponent(externalId),$ref:externalId};
  const response=validateJson(consumer,[]);
  assert.equal(response.ok,false);
  assert(response.errors[0].includes('can'+String.fromCharCode(39)+'t resolve reference '+externalId),JSON.stringify(response));
 }
 assert.equal(validateJson(string,{payload:['next']}).ok,true);
 assert.deepEqual(validateJson(string,{payload:[11]}).issues,[{path:['payload','0'],message:'must be string'}]);
 assert.equal(validateJson(integer,{payload:[13]}).ok,true);
 return {isolatedIds:[rootId,embedded,leafId]};
});
checkCase('failed compilation cannot contaminate another schema or prevent later valid compilation',()=>{
 const shared='https://cleanup.scope.test/failed/';
 const missing=validateJson({$id:shared, definitions:{inserted:{$id:'member',type:'integer'}}, $ref:'missing'},1);
 assert.equal(missing.ok,false);
 assert.match(missing.errors[0],/can't resolve reference missing/);
 assert.equal(validateJson({$ref:shared+'member'},1).ok,false);
 const good={$id:shared, definitions:{inserted:{$id:'member',type:'string'}},$ref:'member'};
 assert.equal(validateJson(good,'repaired').ok,true);
 assert.deepEqual(validateJson(good,42).issues,[{path:[],message:'must be string'}]);
 return missing.errors;
});
checkCase('distinct mixed-content cache churn stays below the existing five-second window in this isolated probe',()=>{
 const started=performance.now();
 for(let i=0;i<290;i++){
  const id='https://cleanup.scope.test/churn/'+(i%7)+'/root';
  const schema={$schema:i%2?'http://json-schema.org/schema':'http://json-schema.org/draft-07/schema#',$id:id,definitions:{value:{$id:'value',type:'integer',const:i}},$ref:'value'};
  assert.equal(validateJson(schema,i).ok,true);
  assert.equal(validateJson(schema,i+1).ok,false);
 }
 const elapsedMs=Math.round(performance.now()-started);
 assert(elapsedMs<5000,'290 scoped compile/validate cycles took '+elapsedMs+'ms');
 return {elapsedMs,distinctContents:290,rootIds:7};
});
console.log(JSON.stringify(cases,null,2));
if(cases.some(t=>t.status!=='pass'))process.exitCode=1;

