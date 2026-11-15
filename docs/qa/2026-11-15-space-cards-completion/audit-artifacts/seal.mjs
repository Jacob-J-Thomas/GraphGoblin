import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const root='C:/Users/98jak/.codex/worktrees/gg-20261114-space-cards/GraphGoblin';
const json=name=>JSON.parse(fs.readFileSync(path.join(out,name),'utf8').replace(/^\uFEFF/,''));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const after=json('source-index-after.json'),integrity=json('evidence-integrity.json');
const native=json('native-independent-readback.json'),ci=json('ci-independent-summary.json');
const history=json('historical-native-independent-readback.json'),probe=json('synchronous-public-probe.json');
const head='e1237593babd4d03466b91685fc05dbe49223b2a',base='177f3a7d57768c88f19c6bb4d8ef2b272c1e91bd';
const verdict=`SIGN-OFF: PR #482 at ${head} for target main at ${base} may merge.`;
const report=fs.readFileSync(path.join(out,'report.md'),'utf8');
assert.equal(report.split(/\r?\n/)[0],verdict);
assert.equal((report.match(/SIGN-OFF:/g)||[]).length,1);
assert.equal(after.result,'PASS');assert.equal(integrity.result,'PASS');assert.equal(native.result,'PASS');assert.equal(history.result,'PASS');assert.equal(probe.result,'PASS');
assert.equal(json('focused-first-run-exit.json').exit,0);
assert.equal(json('synchronous-public-probe-exit.json').exit,0);
for(const p of ['inspect-retained-exit.json','historical-readback-exit.json','final-check-exit.json','report-format-exit.json'])assert.equal(json(p).exitCode,0,p);
assert.equal(sha(after.indexPath),after.indexSha256);
assert.equal(execFileSync('git',['--no-optional-locks','rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),head);
const ciLogNames=['job-132765496147-gates.log','job-132765496455-browser.log','job-132765496437-windows-launcher.log','job-132765496370-template-image.log','job-132765496037-routing.log'];
const ciLogs=ciLogNames.map(name=>({path:`../corrected-ci/${name}`,sha256:sha(path.resolve(out,'../corrected-ci',name))}));
const excluded=new Set(['verification.json','SHA256SUMS','seal-receipt.json']);
const artifacts=fs.readdirSync(out).filter(n=>!excluded.has(n)&&fs.statSync(path.join(out,n)).isFile()).sort().map(name=>({path:name,bytes:fs.statSync(path.join(out,name)).size,sha256:sha(path.join(out,name))}));
const verification={
 schema:'graphgoblin-independent-final-audit-v1',sealedAt:new Date().toISOString(),verdict,
 role:{agent:'/root/audit_482_final',model:'gpt-6-astra',effort:'max',formalScan:2,totalScanCap:3,independentOfImplementationReviewAndNativeQA:true,subagentsUsed:false},
 scope:{pr:482,head,tree:after.tree,target:'main',targetSha:base,nativeSource:'b043d3b8baafdff742803ae46750c8664067f3c7',priorReviewedHead:'daa43634c8a093f2cde8239a3501ae4b6b14c112',effectiveFiles:16,productionFiles:4,testFiles:7,behaviorDocuments:5,productDeltaAfterNativeSource:[],testedMerge:after.testedMerge},
 admission:{path:'root-green-ci-admission.json',sha256:sha(path.join(out,'root-green-ci-admission.json')),status:json('root-green-ci-admission.json').status},
 finalIdentity:{path:'source-index-after.json',observedAt:after.at,head:after.head,base:after.base,indexUnchanged:after.indexUnchanged,indexSha256:after.indexSha256,pr:after.pr,remoteRefs:after.remoteRefs},
 findings:{blocking:[],newNonblocking:[],prior:[{signature:'space-cards/queued-fit-acts-on-replacement-graph',severity:'P2',priorDisposition:'FIX-IN-PR',status:'RESOLVED',source:'apps/web/src/editor/Canvas.tsx:1151-1179',basis:'Captured definition/generation/revision checks followed in the same turn by nonanimated public setViewport; real dependency readiness/supersession cases and independent synchronous public-API probe.'}],parked:[{issue:479,url:'https://github.com/Jacob-J-Thomas/GraphGoblin/issues/479'},{issue:481,url:'https://github.com/Jacob-J-Thomas/GraphGoblin/issues/481'}]},
 acceptance:[
  ['eligibility-explicit-only','PASS','space-cards.ts:23-36; Canvas.tsx:1115-1119; focused helper/store/EditorPage and corrected Apply/N768'],
  ['current-eligibility-geometry-only','PASS','store.ts:859-883; space-cards.ts:189-205; invalid-edge/reference preservation tests and native Apply'],
  ['one-history-revision-save-exact-undo-redo','PASS','store.ts:859-883; ordinary history/autosave/device path; D1 durable records'],
  ['deterministic-linear-topology-height','PASS','space-cards.ts:55-178; bounded traversal and independent 500-node/2000-edge/clearance oracles'],
  ['shared-gesture-keyboard-focus-announcement','PASS_WITH_DECLARED_TIERS','current real-library cases; historical native held Enter during pan'],
  ['one-positive-ready-measured-fit','PASS','Canvas.tsx:263-280,585-589,1151-1179; 44 mock and eight real-library cases'],
  ['supersession-cancellation-public-synchronous-commit','PASS','captured revision plus rendered/live identities; real readiness tests; three direct public setViewport observations'],
  ['measured-result-repeat-press-protection','PASS_WITH_ACCEPTED_COST','SpaceCardsOffer; corrected R512 native hit targets; old-screen-coordinate resize limitation'],
  ['outside-input-and-keyboard-result','PASS_WITH_DECLARED_TIERS','passive capture cleanup; current tests and selected unchanged historical native observations'],
  ['generation-dismiss-result-device-recovery','PASS','current source/tests; corrected D1 reload; historical device conflict/500 recovery'],
  ['docs-boundaries-gates','PASS','five behavior documents; no format/API/dependency/workflow/threshold change; all current jobs success']
 ].map(([criterion,status,evidence])=>({criterion,status,evidence})),
 commandsActuallyRun:[
  {command:'pnpm.cmd --filter @graphgoblin/web test src/editor/space-cards.test.ts src/editor/store.space-cards.test.ts src/editor/Canvas.space-cards.test.tsx src/editor/Canvas.space-cards.gate.test.tsx src/editor/Canvas.space-cards.fit.test.tsx src/editor/EditorPage.space-cards.test.tsx src/editor/Canvas.test.tsx --maxWorkers=1',node:'v22.23.4',attempts:1,exit:0,passed:245,files:7,durationSeconds:85.36,log:'focused-first-run.log'},
  {command:'node synchronous-public-probe.cjs',attempts:1,exit:0,cases:3,log:'synchronous-public-probe.log',tier:probe.boundary},
  {command:'node verify-evidence.mjs',attempts:2,exit:0,firstResult:'first-evidence-integrity.json',log:'evidence-integrity.log',correction:'Classify the one known delivery-register publication metadata change explicitly; compare current bytes against HEAD.'},
  {command:'node inspect-retained.mjs',attempts:2,exit:0,firstResult:'first-native-independent-readback.json',firstLog:'first-inspect-retained.log',log:'inspect-retained.log',correction:'Explicitly account for exactly three existing Add Script defaults in one request; strip ANSI terminal color before CI summary parsing.'},
  {command:'node historical-readback.mjs',attempts:1,exit:0,log:'historical-readback.log',tier:'read-only parsing of historical native evidence'},
  {command:'node final-check.mjs',attempts:1,exit:0,log:'final-check.log'},
  {command:'pnpm.cmd exec prettier --write <external report.md>',attempts:1,exit:0,log:'report-format.log',mutates:'external report only'},
  {command:'git status/rev-parse/ls-files/diff/diff --check/ls-remote',exit:0,purpose:'source, index, diff, and current remote identity verification'},
  {command:'gh api repos/Jacob-J-Thomas/GraphGoblin/{pulls/482,issues/208,git/ref/heads/main,actions/runs/43698926003,actions/runs/43698925969,their jobs,git/commits/2a3ae36fdd72ebceacbfbe2d4f21d5e10c75ad13}',exit:0,purpose:'live read-only fallback after unavailable advertised connector'}
 ],
 ci:{workflowResults:after.workflowResults,coverage:ci,browser:{passed:481,declaredLiveProviderSkipped:1,retries:0,workers:1},windows:{passed:14,skipped:0,uploadedNativeArtifact:false},template:{loaded:4},routing:{groups:2,strict:false,routingP95MediansMs:[6.2,5.4],frameP95Ms:[33.4,50,33.4,50,49.9,33.4],sixtyHzClaim:false,controlledBaseline:false},securityAudit:{threshold:'high',low:8,moderate:13,gate:'PASS'},logs:ciLogs},
 nativeEvidence:{executedByThisAuditor:false,corrected:{source:'b043d3b8baafdff742803ae46750c8664067f3c7',groups:4,checks:194,rawRecords:377,putAttempts:34,acceptedPuts:33,intentionalConflicts:1,rawDefinitionsEquivalent:32,declaredDefaultTransitions:1,edgeVersion:'157.0.4341.60',record:'native-independent-readback.json'},historical:{source:history.source,groups:7,checks:310,acceptedPuts:46,putAttempts:48,scope:'unchanged gesture/result/keyboard/device evidence only; not a seven-group rerun on corrected head',record:'historical-native-independent-readback.json'},nativeUndo:{fitCommittedMs:560.5,trustedUndoMs:574.2,precommitGapDirectlyInjected:false},originalNegativeEdgeVersion:'157.0.4341.46'},
 integrity:{record:'evidence-integrity.json',result:integrity.result,manifestEntries:1783,nativeCopyMapRecords:708,recordedInputs:1692,unchangedInputs:1691,publicationMetadataExceptions:1,buildOutputs:1227,applicationSourceMaps:35,dependencyAndAppChain:6},
 preservedFailures:[
  'Scan1 accepted queued-fit product defect and original controlled native negative at daa.',
  'Original daa CI web: 2883 passed and three failed; subsequent Gates steps skipped.',
  'Implementation initial fixture/lint failures; old-production replay two relevant negatives plus four faulty visibility fixtures; mutation result 9/10.',
  'Original R512 native fixture stop and earlier wrapper parse failure.',
  'Corrected D1 initial wrong native-disabled observer; exact aria-disabled correction3 admitted under D035 behavior-QA exemption, without resetting formal scan cap.',
  'Seven advertised GitHub connector calls unavailable to this agent; successful gh fallback.',
  'Auditor first integrity comparator rejected known delivery metadata change; first files preserved.',
  'Auditor first native parser flagged declared Add Script defaults and failed to parse ANSI-colored Tests summary; first files preserved.'
 ],
 residualLimits:[
  'No owner product acceptance or issue/intent closure. #208 remains open.',
  'Native corrected Undo follows committed fit; precommit cancellation is supported by controlled real-dependency tests and synchronous source/API proof.',
  'Public API probe uses installed CommonJS ReactFlow and synthetic jsdom dimensions; deployed ESM is independently source/map-bound, not natively painted by this probe.',
  'Original negative and corrected native Edge binaries differ.',
  'CSS 24px root override is not actual browser text preference; coarse touch is emulation. Physical input, other engines and screen-reader speech unverified.',
  'Historical native unavailable-gate observation uses trusted Enter during held mouse press; no separate unavailable pointer-click oracle.',
  'Result rectangle intentionally covers content until outside press; later resize does not protect former screen coordinate.',
  'Recovered detailed worker report lacks original digest; exact short summary and provenance erratum are distinct.',
  'Routing strict mode off; frame p95 exceeds optional17ms target; no60Hz or baseline regression claim.',
  'Declared CI skips, lower-severity advisories, absent Windows upload artifact retained.'
 ],
 ownership:{sourceChanged:false,indexChanged:false,buildChanged:false,ownerResourcesTouched:false,protectedPr460Touched:false,ports4747or4748Used:false,providersInvoked:false,publicationPerformed:false,heavySlotReleased:true,rootMustReadFullReportBeforePublication:true,ownerAcceptance:false},
 report:{path:'report.md',sha256:sha(path.join(out,'report.md')),bytes:fs.statSync(path.join(out,'report.md')).size},artifacts
};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(verification,null,2)+'\n');
const receipt={at:new Date().toISOString(),verdict,reportSha256:verification.report.sha256,verificationSha256:sha(path.join(out,'verification.json')),artifactRecords:artifacts.length,indexUnchanged:sha(after.indexPath)===after.indexSha256};
fs.writeFileSync(path.join(out,'seal-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
const manifest=fs.readdirSync(out).filter(n=>n!=='SHA256SUMS'&&fs.statSync(path.join(out,n)).isFile()).sort().map(name=>`${sha(path.join(out,name))}  ${name}`).join('\n')+'\n';
fs.writeFileSync(path.join(out,'SHA256SUMS'),manifest);
console.log(JSON.stringify({...receipt,manifestSha256:sha(path.join(out,'SHA256SUMS'))},null,2));
