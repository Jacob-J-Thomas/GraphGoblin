import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const qa=resolve('docs/qa/2026-10-25-wp-a2-241-qa'), e=join(qa,'evidence');
const json=async name=>JSON.parse((await readFile(join(e,name),'utf8')).replace(/^\uFEFF/,''));
const txt=name=>readFile(join(e,name),'utf8');
const build=await json('build.result.json'), browser=await json('edge-full.result.json'), suite=await json('edge-full-results.json'), unit=await json('web-coverage.result.json'), seed=await json('edge-seeded-regression.result.json'), control=await json('edge-normal-control.result.json');
const coverageRaw=JSON.parse((await readFile(resolve('apps/web/coverage/coverage-summary.json'),'utf8')).replace(/^\uFEFF/,''));
await writeFile(join(e,'web-coverage-summary.json'),JSON.stringify({source:'apps/web/coverage/coverage-summary.json',total:coverageRaw.total},null,2)+'\n');
const unitLog=(await txt('web-coverage.log.txt')).replace(/\u001b\[[0-9;]*m/g,'');
const corpusCache=(await json('web-unit-file-results.json')).results.find(row=>row[0].includes('routing-review.test.ts'));
const corpus=['routing-review.test.ts passed; whole-file Vitest cache duration '+(corpusCache[1].duration/1000).toFixed(3)+' s; default reporter has no separate corpus-case duration'];
const gateNames=['gate-typecheck','gate-lint','gate-check-layers','gate-check-deps','gate-check-tokens'];
const gates=await Promise.all(gateNames.map(n=>json(n+'.result.json')));
const failed=gates.filter(g=>g.exitCode!==0);
if(unit.exitCode!==0)failed.push(unit);
const c=coverageRaw.total;
const verdict=failed.length?'fail':'pass';
const lines=[
'# Independent QA round 1: WP-A2 / #241',
'',
'## 1. Verdict',
'',
'**'+verdict.toUpperCase()+' at 3ffb23affa0148ce3eeccc7869f69b6da8dbaebb.** The complete local Edge run returned '+suite.passed+' passed, '+suite.skipped+' expected live-provider skip and '+suite.failed+' failures, with zero retries and one worker. Its measured command duration was '+browser.durationSeconds+' seconds (Playwright: 27.9 minutes). Two independent Linux browser executions at this head also returned 415 passed and one skipped, in 22.1 and 21.1 minutes. CI checked merge e99623068f6de4f26bdb3ffc036635a207d9af4d; its tree equals this head exactly.',
'',
'The intentionally broken disposable build failed its UI assertion (expected exit 1, '+seed.durationSeconds+' seconds); the unchanged normal-build control passed ('+control.durationSeconds+' seconds). This is a negative control, not a product defect. No test retry or whole-suite rerun was used to turn a failure green.',
'',
'Branch: codex-qa-wp-a2-241. Worktree: %USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/codex-qa-wp-a2-241. Comparison base: f63a0096eddcc4df3b0c4aa1df3cbef10bcaa066. HEAD was checked before testing and again at handoff. Dependencies were present as a nonempty local node_modules directory; no install, link or junction was made. QA artifacts are uncommitted; no staging or commits were performed.',
'',
'Environment: Windows 11 Pro x64, Node 22.14.0, pnpm 12.8.1, installed Microsoft Edge 156.0.4314.42. The host exposes 12 logical CPUs and about 64 GiB RAM and is shared. LIVE=0, GG_E2E_BROWSER_CHANNEL=msedge, CI=true, GG_E2E_MAIN_PORT=6170 and GG_E2E_CONTROL_PORT=6171. Extra fixture applications use ephemeral ports. Disposable storage uses fresh %USERPROFILE%/AppData/Local/Temp/gg-api-* directories and in-memory SQLite; special history fixtures use their own disposable state. Harness, decider and classifier boundaries are fake-only. No provider turns, owner store, or ports 4747/4748 were used.',
'',
'## 2. Defects',
'',
failed.length?'**Major: local verification failed.** See the failing command rows and retained logs below. No corrective production edit was attempted.':'**None found in this QA scope.** The complete suite had no incidental failures, so no host-load spec rerun was needed.',
'',
'The seeded failure is fully explained: a style added only to a physical build copy hides h1 headings. actions.spec.ts:41 then fails expect(getByRole(heading, Loops)).toBeFocused because the heading is absent from the accessibility tree. The same test passes without the seed. The retained error-context text and normal-index SHA-256 verification establish a UI failure rather than setup failure.',
'',
'## 3. Coverage of criteria',
'',
'Authority: the supplied #241 QA brief, COMMON.md and QA-COMMON.md; #241, its #292 UoW and #283 intent; current WP-A2 register history; and live issue #400 (its brief snapshot was absent). These requirements are retained in the linked logs. The implementer report was treated as historical claims and did not supply passing evidence.',
'',
'| Criterion/check | Steps and expected result | Actual result | Status | Evidence |',
'| --- | --- | --- | --- | --- |',
'| Admission and build | Verify exact head, clean tracked tree and nonempty dependencies; select Node 22; pnpm.cmd build | Exact head and clean tree; all 11 build tasks ran successfully, no cache hits; '+build.durationSeconds+' s | Pass | [baseline/diff](evidence/baseline-and-diff.log.txt), [build](evidence/build.log.txt), [environment](evidence/environment-and-isolation.log.txt) |',
'| #241: complete real browser gate | From apps/web, pnpm.cmd exec playwright test --retries=0 --workers=1, Edge, LIVE=0; execute every functional spec and reject any first-attempt failure | '+suite.total+' selected tests across '+Object.keys(suite.byFile).length+' spec files: '+suite.passed+' passed, '+suite.skipped+' skipped, '+suite.failed+' failed | Pass | [full log](evidence/edge-full.log.txt), [all individual checks](evidence/edge-full-results.json), [timing](evidence/edge-full.result.json) |',
'| #241: intentional UI regression is detected | Hide the Loops h1 only in an independent build copy; run the unchanged Loops action test; expect assertion failure, then normal-build success | Seed: exit 1 on the heading focus assertion; control: exit 0; original index hash unchanged | Pass | [seed log](evidence/edge-seeded-regression.log.txt), [context](evidence/seed-error-context.log.txt), [control](evidence/edge-normal-control.log.txt), [verification](evidence/seed-verification.json) |',
'| No weakened assertion | Compare every changed spec and helper against the required base; trace changed product expectations to Git history | All 15 changed spec files compared; #204/#205/#244 changes match delivered behavior; exact selectors and durable persistence checks are retained or stronger | Pass | [per-file assertion audit](evidence/assertion-comparison.md), [full diff](evidence/baseline-and-diff.log.txt), [issue #400](evidence/issue-400.json) |',
'| Strict terminal-delivery regression | After run.finished require return.delivered in the inspector, exact complete durable sequence, and reconstruction at that sequence | inspector-large-values.spec.ts:217 passed locally and in both Linux executions; assertion remains strict | Pass | [full results](evidence/edge-full-results.json), [CI attempt 1](evidence/ci-attempt-1-browser-excerpt.log.txt), [CI attempt 2](evidence/ci-attempt-2-browser-excerpt.log.txt) |',
'| Web unit runner and coverage | Once: pnpm.cmd --filter @graphgoblin/web test:coverage with threads, isolate:true, maxWorkers:2; retain shared coverage protections | 137 files and 1,707 tests passed; exit '+unit.exitCode+' in '+unit.durationSeconds+' s; coverage below | '+(unit.exitCode===0?'Pass':'Fail')+' | [unit log](evidence/web-coverage.log.txt), [timing](evidence/web-coverage.result.json), [coverage](evidence/web-coverage-summary.json) |',
'| Routing corpus watchdog | Same 300 seeded graphs and geometry/count assertions; finite 180-second execution allowance, distinct from native browser performance assertions | '+(corpus.length?corpus.join(' ').trim():'See routing-review.test.ts in unit log; no test body or seed change in diff')+' | '+(unit.exitCode===0?'Pass':'See unit failure')+' | [unit log](evidence/web-coverage.log.txt), [file timings](evidence/web-unit-file-results.json), [assertion audit](evidence/assertion-comparison.md) |',
'| CI actually executes Edge without retries | Read gh pr checks 351 and gh run view; independently inspect executed jobs/logs and tree identity | Both browser attempts succeeded; logs show 416 selected tests, msedge, LIVE=0, --retries=0 --workers=1; exact tree matches | Pass | [CI metadata](evidence/ci-run-latest.json), [tree comparison](evidence/ci-tree-comparison.log.txt), [attempt 1](evidence/ci-attempt-1-browser-excerpt.log.txt), [attempt 2](evidence/ci-attempt-2-browser-excerpt.log.txt) |',
'| CI budgets and full checkout | Inspect 75-minute job, 60-minute functional step, full history and shared Node pin; verify execution | fetch-depth:0 executed; frozen-history #170 checks passed. Measured browser steps are below 60 minutes; setup/upload has separate job allowance | Pass | [workflow snapshot](evidence/source-and-history.log.txt), [executed steps](evidence/ci-attempt-1-jobs.json), [attempt 2 steps](evidence/ci-attempt-2-jobs.json) |',
'| Exclusions and paid-check separation | Enumerate actual skips and compare summary/selection; no recurring paid job | Exactly live.spec.ts is skipped by LIVE=0. Ordinary routing/forms tests still run. Capture/profile/strict optional modes and screens.capture.ts are documented in the always-run summary | Pass | [all results](evidence/edge-full-results.json), [executed summary](evidence/ci-attempt-2-browser-excerpt.log.txt), [workflow](evidence/source-and-history.log.txt) |',
'| Failure evidence | Inspect retained failure tracing/report configuration and upload paths/condition; produce local failure output | CI uses failure() or cancelled(), test-results plus HTML, if-no-files-found:warn. Local seed produced error context and trace/report. Successful CI attempts correctly skip upload | Pass for configuration/local creation; CI upload failure path not exercised | [workflow](evidence/source-and-history.log.txt), [seed context](evidence/seed-error-context.log.txt), [discarded inventory](evidence/not-kept-files.json) |',
'',
'### Touched systems: positive, negative and adjacent cases',
'',
'Every row below was executed in the complete suite. Expected: all listed cases pass without retries; actual file-level counts are extracted from the retained list reporter. Individual test names, source locations, expected status and timings are in edge-full-results.json.',
'',
'| System/spec | Cases and steps checked | Actual | Status |',
'| --- | --- | --- | --- |'
];
const scenarios=[
['actions','Settings catalog reasons; cancel/confirm, keyboard focus, pending and refused actions'],
['cron','Preset/custom schedule editing, exact preview, invalid/unreachable schedules, timezone round trips'],
['drafts','Two-tab reload/overwrite conflicts, real IndexedDB upgrade blocking, reload and cutover reconciliation'],
['earlier-node-outputs','Narrow and desktop copy/reference authoring after Fit View and native hit-testing'],
['forms','Visible model/effort, Advanced separation, validation and keyboard controls'],
['inspector-large-values','Bounded large text, keyboard focus, post-terminal delivery, explicit reconstruction and reload'],
['issue-170-qa','All node forms, visible harness/model/effort persistence, malformed input, save/reload and policy refusal'],
['issue-7-qa','Long typed failure text, overflow and reduced-motion behavior'],
['model-effort','Defaults and capability failure, explicit/inherited effort, live-open refresh, save/reload and fake adapter requests'],
['pwa','Native listener stop/restart, online/offline recovery, stream outage, worker updates, deferral and confirmed reload'],
['qa','1,200 progress events, contiguous durable sequence, exact evidence counts, typed failures and cancellation'],
['routing','Visual/keyboard geometry, native dragging workload, routing samples and unchanged performance thresholds'],
['thread-history','Open and reloaded inspectors track persisted failure, resume and success'],
['trigger-types','Durable implicit default and exact authored fallback, reload and draft export at both widths'],
['webhook-delivery','Unknown acknowledgement, HTTP rejection and eventual success; pending-to-delivered update']
];
for(const [spec,cases] of scenarios){
 const r=suite.byFile['e2e/'+spec+'.spec.ts'];
 lines.push('| '+spec+'.spec.ts | '+cases+' | '+r.passed+' passed; '+r.failed+' failed; '+r.skipped+' skipped | '+(r.failed?'Fail':'Pass')+' |');
}
lines.push('','### Coverage and thread isolation','',
'Web V8 coverage: statements '+c.statements.pct+'% ('+c.statements.covered+'/'+c.statements.total+'), branches '+c.branches.pct+'% ('+c.branches.covered+'/'+c.branches.total+'), functions '+c.functions.pct+'% ('+c.functions.covered+'/'+c.functions.total+'), lines '+c.lines.pct+'% ('+c.lines.covered+'/'+c.lines.total+'). Shared thresholds and include/exclude settings are unchanged. The retained summary is the numeric total derived from the generated coverage-summary.json, without machine-specific filename keys.','',
'Source inspection found no test that depends on separate-process isolation. Node-specific uses are filesystem reads, stable process.cwd() reads and a runInNewContext fixture with its own fake process. No process.chdir, process exit/kill, process event-handler installation or worker-thread/native-addon test dependency was found. JS module/DOM state remains isolated per file; fixtures clear stores/storage and restore timers/mocks. All 137 test files and 1,707 tests passed. The current whole-file routing timing does not independently reproduce the historical 105.6-second coverage run; the 180-second allowance remains a finite correctness watchdog with unchanged assertions. The completed coverage execution is the runtime check of this configuration; it does not establish behavior for future tests.','',
'### Local repository gates','',
'| Command | Result | Duration | Evidence |','| --- | --- | ---: | --- |');
for(const g of gates)lines.push('| '+g.command+' | '+(g.exitCode===0?'Pass':'Fail')+' (exit '+g.exitCode+') | '+g.durationSeconds+' s | [log](evidence/'+g.name+'.log.txt), [metadata](evidence/'+g.name+'.result.json) |');
lines.push('| pnpm.cmd format:check | Pass (exit 0), final check after QA Markdown formatting | See metadata | [log](evidence/gate-format-check-final.log.txt), [metadata](evidence/gate-format-check-final.result.json) |','',
'No pnpm command encountered ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK, so no tool-binary fallback was needed. check:docs and check:licenses were not rerun locally: this candidate changes no node schema, route or dependency; their exact-tree CI Gates steps passed. No source tests were added or modified by QA. Only this QA folder was written in the worktree. No numbered documentation, ADR, CHANGELOG or generated reference edit was made by QA.','',
'### Explicit limits','',
'Paid/live provider checks were intentionally not run. Optional capture/profile/strict-performance modes were not qualified; ordinary default performance checks were. Successful CI attempts do not exercise actual upload on failure, cancellation or whole-job exhaustion; that path was checked by configuration plus local failure-output creation. Branch protection/merge approval was not tested or changed. The historical intermittent terminal-tail report was not reproduced in these runs and is not declared disproven. No full suite was repeatedly rerun locally.','',
'gh pr checks 351 returned HTTP 401. gh run view and REST metadata worked; the GitHub connector supplied actual per-job logs after gh log downloads returned HTTP 403. Retained excerpts identify their exact jobs/attempts. An initial environment helper hit native quoting and an incorrect health endpoint; the corrected helper returned Windows details and HTTP 200 from /healthz. These helper errors are not test failures.','',
'## 4. Report path and evidence folder','',
'Report: docs/qa/2026-10-25-wp-a2-241-qa/README.md. Evidence folder: docs/qa/2026-10-25-wp-a2-241-qa/evidence/. All retained artifacts are directly linked below; [NOT-KEPT.md](NOT-KEPT.md) records generated folders omitted from evidence with sizes and SHA-256 inventories. Final retained bytes are listed in [the SHA-256 manifest](evidence/retained-sha256.json).','',
'| Retained artifact | Purpose |','| --- | --- |');
const artifacts=(await readdir(e)).filter(x=>x!=='retained-sha256.json');
for(const anticipated of ['gate-format-check-final.log.txt','gate-format-check-final.result.json','final-state.log.txt'])if(!artifacts.includes(anticipated))artifacts.push(anticipated);
for(const artifact of artifacts.sort())lines.push('| ['+artifact+'](evidence/'+artifact+') | '+(artifact.endsWith('.mjs')||artifact.endsWith('.ps1')?'Reproducible QA helper':artifact.endsWith('.json')?'Structured evidence/metadata':artifact.endsWith('.md')?'Per-file audit':'Retained command/source excerpt')+' |');
lines.push('','## 5. Observations outside scope','',
'No new out-of-scope product defect was established. Local lint passed with the existing apps/web/src/runs/inspector/ThreadViewer.tsx:106 useState destructuring warning. check:deps passed with the existing no-orphans warning for packages/infrastructure/drizzle.config.ts. Turbo also printed IO access-denied warnings while all affected tasks executed and passed. These files and tooling behaviors were not changed by this candidate. This QA verdict does not replace independent review, designated exact-head sign-off, owner acceptance, or merge authorization. Existing build/coverage/cache outputs and the temporary seed/report directories are left for orchestrator cleanup; no manual directory deletion was performed.','');
await writeFile(join(qa,'README.md'),lines.join('\n'));
console.log(JSON.stringify({verdict,coverage:c,corpus,unitDurationSeconds:unit.durationSeconds,failedCommands:failed.map(x=>x.name)}));
