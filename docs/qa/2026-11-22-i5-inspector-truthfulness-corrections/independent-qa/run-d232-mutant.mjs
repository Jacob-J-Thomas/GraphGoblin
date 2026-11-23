// Exact deliberate mutation in the admitted disposable QA copy, always restored in finally.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const O=dirname(fileURLToPath(import.meta.url)),M=join(O,'d232-mutation-01'),QA=resolve('G:/ggq/gg-i5-d231-correction-qa/GraphGoblin'),E=join(O,'execution-01'),H2='2416fc36b703b88d5fa41cbcf42f7f6f2c57dbd9',TREE='d63ea9f1a2af302ed74cc3c42c36a31055259423';
if(process.argv[2]!=='--root-heavy-slot-released')throw Error('Root heavy slot release required');
const sha=b=>createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(readFileSync(p,'utf8')),ref=p=>({source:p,bytes:readFileSync(p).length,sha256:sha(readFileSync(p))}),put=(p,b)=>{if(existsSync(p))throw Error('New mutation output required');writeFileSync(p,b,{flag:'wx'});return ref(p);},emit=(p,v)=>put(p,Buffer.from(JSON.stringify(v,null,2)+'\n'));
const ordinary=read(join(E,'d232-ordinary.json')),ordinaryCommand=read(join(E,'d232-ordinary.command.json'));if(ordinaryCommand.exitCode!==0||ordinary.numTotalTests!==6||ordinary.numPassedTests!==6||ordinary.numFailedTests!==0)throw Error('Ordinary sixcase baseline must pass before mutation');
const target=join(QA,'apps/web/src/api/ApiKeyPanel.tsx'),test=join(QA,'apps/web/src/api/ApiKeyPanel.test.tsx'),original=readFileSync(join(M,'production-before.tsx')),expectedMutant=readFileSync(join(M,'production-mutant.expected.tsx')),fixedTest=readFileSync(join(M,'corrected-test.fixed.tsx'));
if(!readFileSync(target).equals(original)||!readFileSync(test).equals(fixedTest)||sha(original)!=='eeb305c715fd6f60d1d444ca54daa90cb3d87d3fc27e4c4f3a15bd7afbe5dd53')throw Error('Exact admitted source/test mismatch');
const indexBefore=ref(join(QA,'.git/index')),sourceBefore=ref(target),testBefore=ref(test),startedUtc=new Date().toISOString();let invocationExit=null,invokeError=null,restored=false;
try{
 const fragment='!previous.rejected || ';if(original.toString('utf8').split(fragment).length!==2)throw Error('Exactly one22byte guard required');const mutant=Buffer.from(original.toString('utf8').replace(fragment,''));if(!mutant.equals(expectedMutant)||original.length-mutant.length!==22)throw Error('Mutation not exact prepared prefix removal');
 writeFileSync(target,mutant);if(!readFileSync(target).equals(mutant)||!readFileSync(test).equals(fixedTest))throw Error('Mutant write mismatch');put(join(M,'production-mutant.tsx'),readFileSync(target));
 try{execFileSync(process.execPath,[join(O,'run-command.mjs'),'d232-mutant','--root-heavy-slot-released'],{cwd:QA,env:process.env,stdio:'inherit'});invocationExit=0;}catch(error){invocationExit=typeof error.status==='number'?error.status:null;invokeError=error.code??error.message;}
}finally{
 writeFileSync(target,original);restored=readFileSync(target).equals(original)&&readFileSync(test).equals(fixedTest);put(join(M,'production-restored.tsx'),readFileSync(target));
 const env={...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1'};for(const k of Object.keys(env))if(k.startsWith('GIT_')&&!['GIT_OPTIONAL_LOCKS','GIT_NO_LAZY_FETCH'].includes(k))delete env[k];
 const git=(...a)=>execFileSync('git',['--no-optional-locks','-c','maintenance.auto=false','-c','gc.auto=0',...a],{cwd:QA,env}).toString('utf8').trim();
 const after={head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),trackedChanges:git('diff','--name-only','--no-ext-diff','--no-textconv','HEAD','--'),index:ref(join(QA,'.git/index')),production:ref(target),test:ref(test)};
 emit(join(M,'restoration-receipt.json'),{state:restored?'EXACT_H2_PRODUCTION_RESTORED':'RESTORATION_FAILED',startedUtc,finishedUtc:new Date().toISOString(),qa:QA,sourceHead:H2,sourceTree:TREE,sourceBefore,testBefore,indexBefore,after,onlyAssignedQaGuardWritten:true,authorCheckoutNeverOpenedOrWritten:true,productionRestored:restored,testSourceUnchanged:readFileSync(test).equals(fixedTest),invocationExit,invokeError,productBehaviorClassification:'PENDING_RAW_MUTANT_FAILURE_READBACK',providerCalls:0});
 if(!restored||after.head!==H2||after.tree!==TREE||after.trackedChanges||after.index.sha256!==indexBefore.sha256)throw Error('Restoration/source/index invariant failed');
}
console.log(JSON.stringify({state:'MUTANT_INVOCATION_FINISHED_SOURCE_RESTORED_PENDING_CLASSIFICATION',invocationExit,restored,receipt:join(M,'restoration-receipt.json')}));
