import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=import.meta.dirname;
const exec=path.join(root,'runtime-381-functional-candidate-execution-1');
const evidence=path.join(root,'runtime-381-native-functional-preparation-v5/corrected-attempt-1');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const index=json(path.join(exec,'case-index.json'));
assert.equal(index.cases.length,18);
for(const c of index.cases){
 const file=path.join(evidence,c.id,'before-recovery.json');
 assert.equal(sha(file),c.beforeSha256);
 const raw=json(file);
 assert.equal(raw.run.status,c.status);
 assert.equal(raw.run.failure?.code??null,c.code);
 assert.equal(raw.run.failure?.message??null,c.diagnostic);
 assert.equal(raw.run.lastEventSeq,c.lastEventSeq);
 assert.equal(raw.raw.rows[0].last_event_seq,c.lastEventSeq);
 assert.equal(raw.events.at(-1).seq,c.lastEventSeq);
 assert.equal(raw.raw.events.at(-1).seq,c.lastEventSeq);
 const terminal=raw.events.filter(e=>['run.finished','run.failed','run.cancelled'].includes(e.type));
 assert.equal(terminal.length,1);
 assert.equal(terminal[0].seq,c.terminalEventSeq);
 assert.equal(terminal[0].type,c.terminalEventType);
 assert.deepEqual(raw.events.filter(e=>e.seq>c.terminalEventSeq).map(({seq,type})=>({seq,type})),c.postTerminalEvents);
 if(c.code==='MUTATION_ERROR'){
  assert.equal(raw.run.failure.details.operationIndex,c.operationIndex);
  assert.equal(raw.run.failure.details.operationKind,c.operationKind);
  assert.equal(raw.run.failure.resumable,false);
 }
 if(c.refusal){
  const after=json(path.join(evidence,c.id,'after-recovery.json'));
  assert.deepEqual(raw.raw,after.afterRows);
  assert.equal(after.after.lastEventSeq,raw.run.lastEventSeq);
 }
}
const inspectors=index.inspectors.map(c=>{
 const read=json(path.join(evidence,c.id,'inspector-readback.json'));
 assert.equal(read.failureText,c.failureText);
 assert.equal(read.disabled,!c.resumeEnabled);
 return {id:c.id,visuallyReadByRoot:true,pngSha256:sha(path.join(evidence,c.id,'inspector.png')),domSha256:sha(path.join(evidence,c.id,'inspector-dom.html'))};
});
for(const relative of index.controlledPrivateDiagnostic.checkedPublicEvidence){
 const content=fs.readFileSync(path.join(evidence,relative),'utf8');
 assert(!content.includes('C:/qa-381-private-message/'));
 assert(!content.includes('D:/qa-381-private-stack/'));
}
assert.equal(json(path.join(exec,'exit.json')).exitCode,0);
const receipt={at:new Date().toISOString(),sourceHead:'615d50bc358d73bc55ad0591f4f625f1a46cb671',reportFullRead:true,reportSha256:sha(path.join(exec,'report.md')),caseIndexSha256:sha(path.join(exec,'case-index.json')),exitCode:0,rawCases:index.cases.map(c=>({id:c.id,status:c.status,code:c.code,rawSha256:c.beforeSha256})),inspectors,privateDiagnostic:'Root read correlated private message and stack entry; both synthetic paths absent from seven indexed public artifacts',cleanup:'runtime-381-functional-candidate-cleanup-root-readback.json',verifierCorrection:'First read-only PowerShell probe compared nonexistent after.raw instead of actual after.afterRows and stopped without writing acceptance. Corrected schema comparison here; no harness or product rerun.',verdict:'Accepted all 18 scoped functional observations; internal candidate and current CI/reviews remain'};
fs.writeFileSync(path.join(root,'runtime-381-functional-candidate-root-acceptance.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({cases:18,inspectors:3,reportSha256:receipt.reportSha256,verdict:receipt.verdict}));
