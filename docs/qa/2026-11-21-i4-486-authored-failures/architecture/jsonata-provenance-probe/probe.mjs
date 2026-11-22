// Finite read-only planning probe. This does not implement or approve a classifier.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root=path.dirname(fileURLToPath(import.meta.url));
const repo='G:/ggq/gg-i4-486-authored-errors/GraphGoblin';
const output=path.join(root,'results.json');
assert(!fs.existsSync(output),'Refuse to overwrite a prior observation');
assert.equal(process.version,'v22.23.4');
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'});
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'});
const admission=JSON.parse(fs.readFileSync(path.join(root,'admission.json'),'utf8'));
const predictions=JSON.parse(fs.readFileSync(path.join(root,'predictions.json'),'utf8'));
const caseBytes=fs.readFileSync(path.join(root,'cases.json'));
assert.equal(hash(caseBytes),predictions.casesSha256);
const cases=JSON.parse(caseBytes).cases;
assert.equal(cases.length,40);
assert.equal(git('rev-parse','HEAD').trim(),admission.head);
assert.equal(git('status','--porcelain=v1'),'');
for(const entry of admission.sources.filter(x=>!path.isAbsolute(x.path))){
 assert.equal(hash(fs.readFileSync(path.join(repo,entry.path))),entry.sha256,entry.path);
}
const fromApi=createRequire(pathToFileURL(path.join(repo,'apps/api/package.json')));
const domainEntry=fromApi.resolve('@graphgoblin/domain');
const domain=await import(pathToFileURL(domainEntry).href);
const expression=await import(pathToFileURL(path.join(repo,'packages/domain/src/expression.ts')).href);
const requireDomain=createRequire(pathToFileURL(path.join(repo,'packages/domain/package.json')));
const jsonataPath=requireDomain.resolve('jsonata');
const jsonata=requireDomain('jsonata');
const jsonataPackagePath=requireDomain.resolve('jsonata/package.json');
const jsonataPackage=JSON.parse(fs.readFileSync(jsonataPackagePath,'utf8'));
assert.equal(jsonataPackage.version,'2.2.2');
const builtin=await jsonata('$error').evaluate({});
const sourcesBefore={expression:hash(fs.readFileSync(path.join(repo,'packages/domain/src/expression.ts'))),lock:hash(fs.readFileSync(path.join(repo,'pnpm-lock.yaml')))};
save('execution-input.json',{
 at:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
 execPath:process.execPath,argv:process.argv,head:admission.head,tree:admission.tree,
 predictionsSha256:hash(fs.readFileSync(path.join(root,'predictions.json'))),casesSha256:hash(caseBytes),scriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),
 domainPublicEntry:domainEntry,expressionAstSourceExport:typeof expression.expressionAst,expressionAstPackageEntryExport:Object.hasOwn(domain,'expressionAst'),
 dependency:{version:jsonataPackage.version,modulePath:fs.realpathSync(jsonataPath),moduleSha256:hash(fs.readFileSync(jsonataPath)),packageJsonPath:fs.realpathSync(jsonataPackagePath),packageJsonSha256:hash(fs.readFileSync(jsonataPackagePath)),patchSha256:hash(fs.readFileSync(path.join(repo,'patches/jsonata@2.2.2.patch')))},
 builtinValueFacts:{keys:Object.keys(builtin),jsonataFunctionFlag:builtin._jsonata_function,implementationType:typeof builtin.implementation,implementationSourceSha256:hash(builtin.implementation.toString())},
 scope:'Forty predeclared bounded cases. Raw JSONata and actual public domain evaluation, plus read-only source-module AST inspection. No helper/classifier, app/API/browser, provider or arbitrary fuzzer. Synthetic canaries remain in private raw QA.'
});
function snapshot(value,seen=new Set()){
 if(value===undefined)return {jsonType:'undefined'};
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='function')return {jsonType:'function',name:value.name};
 if(typeof value==='symbol')return {jsonType:'symbol',description:value.description};
 if(typeof value!=='object')return String(value);
 if(seen.has(value))return {jsonType:'cycle'};
 seen.add(value);
 if(Array.isArray(value)){const out=value.map(x=>snapshot(x,seen));seen.delete(value);return out;}
 const out={};
 for(const key of Object.getOwnPropertyNames(value)){
  try{out[key]=snapshot(value[key],seen);}catch(error){out[key]={snapshotAccessFailed:String(error)};}
 }
 seen.delete(value);return out;
}
function profile(name,baseInput){
 const calls=[],injectedErrors=[];
 const input={...baseInput};let bindings={};
 const sameCode=label=>{calls.push({action:'external-function',label});const e={code:'D3137',message:label};injectedErrors.push(e);throw e;};
 const returning=label=>{calls.push({action:'external-function',label});return 'PRIVATE_C486_EXTERNAL_RETURN';};
 if(name==='enumerable-return')bindings.error=returning;
 else if(name==='enumerable-same-code')bindings.error=sameCode;
 else if(name==='jsonata-function-same-code')bindings.error={_jsonata_function:true,implementation:sameCode};
 else if(name==='nonenumerable-error')Object.defineProperty(bindings,'error',{enumerable:false,value:sameCode});
 else if(name==='inherited-error')bindings=Object.create({error:sameCode});
 else if(name==='error-getter-throws'||name==='other-getter-throws')Object.defineProperty(bindings,name==='error-getter-throws'?'error':'unrelated',{
  enumerable:true,get(){calls.push({action:'binding-getter'});const e=new Error('PRIVATE_C486_GETTER_CANARY');injectedErrors.push(e);throw e;}
 });
 else if(name==='actual-builtin')bindings.error=builtin;
 else if(name==='dollar-prefixed')bindings.$error=sameCode;
 else if(name==='input-error-property')input.error=sameCode;
 else if(name==='domain-error')bindings.error=label=>{calls.push({action:'external-function',label});const e=new domain.ExpressionError('PRIVATE_C486_INJECTED_DOMAIN',{privateMarker:'PRIVATE_C486_DETAILS'});injectedErrors.push(e);throw e;};
 else assert.equal(name,'default');
 return {input,bindings,calls,injectedErrors};
}
async function capture(fn,state){
 try{return {outcome:'return',value:snapshot(await fn()),calls:state.calls};}
 catch(error){return {outcome:'throw',error:snapshot(error),errorName:error?.name??null,errorCode:error?.code??null,errorMessage:error?.message??null,constructorName:error?.constructor?.name??null,isExpressionError:error instanceof domain.ExpressionError,sameObjectAsInjected:state.injectedErrors.includes(error),calls:state.calls};}
}
const results=[];
for(const c of cases){
 const astBefore=expression.expressionAst(c.source);
 const ast=snapshot(astBefore);
 const rawState=profile(c.bindingProfile,c.input);
 const domainState=profile(c.bindingProfile,c.input);
 // Deliberately mirror the domain's spread within the captured invocation. A getter fault is
 // recorded as a pre-JSONata preparation fault, not falsely described as a builtin rejection.
 const raw=await capture(()=>jsonata(c.source).evaluate(rawState.input,{...rawState.bindings}),rawState);
 const evaluated=await capture(()=>domain.evaluateExpression(c.source,domainState.input,{bindings:domainState.bindings,timeoutMs:1000,maxDepth:100}),domainState);
 const actual={astRootType:ast.type,rawOutcome:raw.outcome,rawCode:raw.errorCode??null,domainOutcome:evaluated.outcome,domainCode:evaluated.errorCode??null};
 const mismatches=[];
 for(const [key,value] of Object.entries(c.prediction))if(actual[key]!==value)mismatches.push({fact:key,predicted:value,actual:actual[key]});
 const row={id:c.id,source:c.source,bindingProfile:c.bindingProfile,prediction:c.prediction,actual,mismatches,predictionResult:mismatches.length?'PREDICTION-MISMATCH':'MATCHED-PREDICTION',ast,astUnchangedAfterEvaluation:JSON.stringify(ast)===JSON.stringify(snapshot(astBefore)),rawEvaluatorWithDomainBindingSpread:raw,publicDomain:evaluated};
 results.push(row);
 fs.appendFileSync(path.join(root,'observations.jsonl'),JSON.stringify(row)+'\n');
}
const direct=results.find(x=>x.id==='S12-post-shadow-cache-builtin');
const plain=results.find(x=>x.id==='S02-own-enumerable-same-code');
const shaped=results.find(x=>x.id==='S03-jsonata-function-same-code');
const publicProjection=x=>({name:x.publicDomain.errorName,code:x.publicDomain.errorCode,message:x.publicDomain.errorMessage,details:x.publicDomain.error?.details});
const regexControl={
 scope:'A deliberately incomplete JavaScript end-anchor control, not a classifier or proposed implementation.',
 pattern:'^[A-Za-z0-9 _-]{1,128}$',
 normalIntrinsicTest:/^[A-Za-z0-9 _-]{1,128}$/.test('A'),
 terminalNewlineIntrinsicTest:/^[A-Za-z0-9 _-]{1,128}$/.test('A\n')
};
assert.equal(hash(fs.readFileSync(path.join(repo,'packages/domain/src/expression.ts'))),sourcesBefore.expression);
assert.equal(hash(fs.readFileSync(path.join(repo,'pnpm-lock.yaml'))),sourcesBefore.lock);
const indexPathText=git('rev-parse','--git-path','index').trim();
const indexPath=path.isAbsolute(indexPathText)?indexPathText:path.join(repo,indexPathText);
const statusAfter=git('status','--porcelain=v1');
assert.equal(statusAfter,'');
assert.equal(hash(fs.readFileSync(indexPath)),admission.indexSha256);
const final={
 at:new Date().toISOString(),caseCount:results.length,matchedPredictions:results.filter(x=>!x.mismatches.length).length,predictionMismatches:results.filter(x=>x.mismatches.length).map(x=>({id:x.id,mismatches:x.mismatches})),
 sourceCleanAfter:true,indexSha256Unchanged:admission.indexSha256,lockSha256Unchanged:sourcesBefore.lock,
 publicCollisionFacts:{defaultVsExternalPlainD3137PublicProjectionEqual:JSON.stringify(publicProjection(direct))===JSON.stringify(publicProjection(plain)),defaultVsExternalJSONataFunctionD3137PublicProjectionEqual:JSON.stringify(publicProjection(direct))===JSON.stringify(publicProjection(shaped)),projections:{default:publicProjection(direct),externalPlain:publicProjection(plain),externalJSONataFunction:publicProjection(shaped)}},
 regexControl,results,
 limits:'Facts and fallible predictions, not product acceptance, implementation, review, plan approval or proof of arbitrary engine reachability. Raw synthetic labels/markers remain private.'
};
save('results.json',final);
console.log(JSON.stringify({caseCount:final.caseCount,matchedPredictions:final.matchedPredictions,predictionMismatches:final.predictionMismatches,publicProjectionCollisions:{plain:final.publicCollisionFacts.defaultVsExternalPlainD3137PublicProjectionEqual,jsonataFunction:final.publicCollisionFacts.defaultVsExternalJSONataFunctionD3137PublicProjectionEqual},regexControl,sourceCleanAfter:true}));
