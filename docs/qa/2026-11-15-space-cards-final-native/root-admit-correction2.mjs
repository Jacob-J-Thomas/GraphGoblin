import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const p=base+'/review-208-space/final-native-preparation';
const read=n=>readFileSync(p+'/'+n);
const json=n=>JSON.parse(read(n));
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected={'driver-manifest.json':'d1aca602788a5dece542cbbcff5de3f7e0bb05dc6b9f94454d99c2df5865b73f','driver-correction2-manifest.json':'d16681bf1840fad458f267af31abd7ad9576021bd0d5df9a1b90e93c2409f6c5','fixture-corrections-correction2.json':'60d4c7cd73d0e56049fe16f8bcc47e8535f2ed84028304973ac045e79b56b080','binding/binding-before.json':'086fbb626198f220e02620d7c1d7ab277d4837425a951767be471cd9c831f8eb'};
for(const [n,h]of Object.entries(expected))assert.equal(sha(read(n)),h,n);
for(const n of ['driver-manifest.json','driver-correction2-manifest.json'])for(const[f,h]of Object.entries(json(n).files))assert.equal(sha(read(f)),h,f);
const pre=json('correction2-preflight.json');
for(const[f,h]of Object.entries(pre.preservedFirstStop))assert.equal(sha(read(f)),h,f);
const oldLedger=json('fixture-corrections.json'),newLedger=json('fixture-corrections-correction2.json');
assert.equal(newLedger.length,2);assert.deepEqual(newLedger.slice(0,1),oldLedger);assert.deepEqual(newLedger[1].groups,['double-r512']);
assert.equal(json('runs/double-r512-initial/run.json').failure.kind,'unwitnessed');
const cleanup=json('cleanup-final.json');
for(const field of ['ownedLive','listeners','leftoverStoresOrSqlite','unqualifiedPidMatches','resourceFailures'])assert.deepEqual(cleanup[field],[]);
const a=json('admission-native-correction2-proposal.json');
const git=(...args)=>execFileSync('git',['-C',a.checkout,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'');
assert.deepEqual(git('rev-parse','HEAD','HEAD^{tree}','origin/main').split(/\r?\n/),[a.head,a.tree,a.actualMain]);
const grants={
 'correction2':'Root grants exactly one double-r512 correction2 run, same frozen build. This spends global fixture batch2/2. Root read full plan/driver/support delta and raw failure, viewed screenshot and verified hashes. No further fixture correction or retry. Stop on any failure.',
 'remaining-initial':'Conditional root grant: only after double-r512 correction2 passes and owned cleanup is proven, run the six untouched initial groups serially using original drivers; inspect each before next. Stop on any failure. Global fixture2/2 exhausted; no corrections, edits or retries.',
 'final-summary':'Evidence sealing only for all seven groups after admitted executions. No runtime launch authorized by this file. Use final receipt filenames, keep all first-stop artifacts immutable.'
};
const admissions={};
for(const[name,grant]of Object.entries(grants)){
 const x=json('admission-native-'+name+'-proposal.json');
 assert.equal(x.status,'pending-root-authorization');
 assert.equal(x.fixtureLedgerSha256,expected['fixture-corrections-correction2.json']);
 x.status='authorized';x.exclusiveSlotGrant='Exclusive local runtime to /root/review_478_sol1; root and other agents metadata/read-only only until released';x.nativeGrant=grant;
 const file='admission-native-'+name+'.json',bytes=JSON.stringify(x,null,2)+'\n';
 writeFileSync(p+'/'+file,bytes,{flag:'wx'});admissions[file]=sha(bytes);
}
const receipt={at:new Date().toISOString(),head:a.head,tree:a.tree,actualMain:a.actualMain,rootRead:'Complete plan, driver delta, all receipt/ledger changes, first failure and setup source; screenshot viewed; dependency focus callback read',originalManifestFiles:Object.keys(json('driver-manifest.json').files).length,correctionManifestFiles:Object.keys(json('driver-correction2-manifest.json').files).length,preservedFirstStopFiles:Object.keys(pre.preservedFirstStop).length,admissions,grants,allPassed:true};
writeFileSync(p+'/root-correction2-admission.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
const l=JSON.parse(readFileSync(base+'/review-ledger.json','utf8'));l.updatedAt=receipt.at;l.heavyTestSlot={owner:'/root/review_478_sol1',note:'Final Space correction2 then conditional six original groups; no source/index/build changes'};l.heavySlotReadback={state:'GRANTED native',at:receipt.at};Object.assign(l.layout208.finalNative,{state:'Correction2 admitted; six original groups conditional on pass/cleanup. No aggregate verdict.',fixtureBatchesUsed:2,fixtureBatchCap:2,admission:'review-208-space/final-native-preparation/root-correction2-admission.json'});writeFileSync(base+'/review-ledger.json',JSON.stringify(l,null,2)+'\n');
appendFileSync(base+'/CURRENT.md','\n'+receipt.at+': Root FULLREAD accepted finalSpace fixture-only keyboard setup correction2; hashes/originals verified, runtimeadmissions issued toSol. Global2/2 at launch, no further correction. Seven-group native still incomplete. Four externalpublicationpackets rootaccepted, notcopied.\n');
console.log(JSON.stringify(receipt));
