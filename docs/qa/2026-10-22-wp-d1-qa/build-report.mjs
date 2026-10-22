import { readFile, readdir, writeFile } from 'node:fs/promises';
const directory = new URL('.', import.meta.url);
const files = await readdir(directory);
const read = (name) => readFile(new URL(name, directory), 'utf8');
const json = async (name) => JSON.parse(await read(name));
const link = (name) => `[${name}](${name})`;
const trialRows = [];
for (const name of files.filter((n) => /^(sweep-|nested-|random-child-).*\.json$/.test(n)).sort()) {
  const r = await json(name);
  trialRows.push(
    `| ${name.replace('.json', '')} | ${r.requestedDelayMs} / ${r.actualDelayMs.toFixed(2)} ms | ${r.observations} | ${r.atKill.runs.length - 1} | One linked child per level; restart parks on it; input then one finish per parent; 0 gaps | PASS; ${link(name)} |`,
  );
}
const commands = [];
for (const name of files
  .filter((n) => n.endsWith('.txt') && !/^(process-|admission-)/.test(n))
  .sort()) {
  const content = await read(name);
  const command = content.match(/^pnpm\.cmd .*$/m)?.[0];
  if (!command) continue;
  const end = content.match(/END [^\r\n]+ EXIT (\d+)/);
  const tests = content.match(/^\s*Tests\s+([^\r\n]+)/m)?.[1]?.trim() ?? '';
  commands.push(
    `| ${link(name)} | \`${command.replaceAll('|', '\\|')}\` | ${end ? (end[1] === '0' ? 'PASS (0)' : 'FAIL (' + end[1] + ')') : 'INCOMPLETE'}${tests ? ': ' + tests.replaceAll('|', '/') : ''} |`,
  );
}
const contractCount = (await json('admission-results.json')).length;
const finish = await json('failure-before-parent.json');
const wakes = finish.after.events
  .filter((e) => e.run_id === finish.boundary.parent.id && e.type === 'run.woken')
  .map((e) => e.payload.payload?.childFinishedSeq);
const cleanup = files.includes('cleanup-manifest.json')
  ? await json('cleanup-manifest.json')
  : { items: [] };
await writeFile(
  new URL('README.md', directory),
  `# 1. Branch and worktree

**Verdict: FAIL — head \`05080df2d329688b55be9118f9549b7c0076c203\`.** Normal subloop creation/recovery passed the independent process trials. QA-D1-001 leaves the requested missing-parent admission refusal incomplete at the public component boundary. Infrastructure and API coverage gates also failed; isolated passes do not change those original results.

Independent QA, branch \`codex-qa-wp-d1\`, worktree \`<worktree>\`, created at the supplied \`wp-d1-320\` head. Implementation comparison base \`48ecf6e7\`. Uncommitted evidence only. No product file/index/commit/branch/publication changes, and no subagents. Windows, Node **v22.14.0** first on PATH, \`pnpm.cmd\` from PowerShell. UTC evidence timestamps; America/Chicago local time. Disposable stores \`<TEMP>/gg-qa-320-*\`, API ports **5920–5929**. Owner app/store and ports 4747/4748 untouched. No paid provider turns.

# 2. Per bolt

| #320 criterion / requested check | Result | Evidence |
| --- | --- | --- |
| One child identity per normal parent visit across creation/link crash windows | PASS | 15 observational trials; controlled admission/finish boundaries; 3 existing API trials |
| Crash after creation before parent bookkeeping recovers same child | PASS | admitted-before-park.json; real SQLite and hard kill, then built API recovery |
| Finish identity after independent retry and output mapping retry | PASS | failure-before-parent.json; mapping-retry.json |
| Missing-parent refusal and identical admission repeat | PARTIAL / FAIL | ${contractCount} shared cases pass; omitted optional node field bypasses refusal (QA-D1-001) |
| C6 failure/cancellation/no-output semantics | Components PASS; restart suite FAIL | Engine 16/16, API failure 2/2; restart original/isolated logs retained |

**QA-D1-001 — major: parented admission without optional \`parentNodeId\` bypasses parent existence and link checks.**

Run \`node --experimental-import-meta-resolve docs/qa/2026-10-22-wp-d1-qa/admission-negative.mjs\` under Node 22. The script uses public infrastructure SQLite exports and a stopped public RunManager to construct a valid control admission, then submits a child whose \`run.parentRunId\` and initial thread name a nonexistent parent. With \`parentNodeId: 'sub'\`, admission throws \`WEBHOOK_INTENT_CONFLICT\`, leaving no child. Omit only the optional node field in the second case: admission succeeds with a child row and \`run.queued\`, while the parent remains absent. The diagnostic query finds child \`00000000000000000000000008\` / missing parent \`00000000000000000000000009\` without a link.

Expected: refuse a child with a missing parent and require enough identity to link it. Actual: \`childLinkEvent\` (packages/engine/src/admission.ts:118) returns undefined for omitted node identity; SQLite (packages/infrastructure/src/sqlite/admission.ts:192) checks the parent only inside \`if (link)\`. The maintained shared contract deliberately permits a parented row without this field. Normal REST subloop creation supplies both fields and passed; no claim of normal REST duplication or a newly introduced historical regression is made. This is incomplete coverage of the new public admission guarantee and requested negative criterion.

Evidence: ${link('admission-negative.json')}, ${link('admission-negative-run.txt')}, ${link('admission-negative.mjs')}. The diagnostic exits 1; its temporary store was removed.

# 3. Files changed

Only this QA directory: report, reproducible harness/configuration, sanitized logs, and JSON store/event evidence. No dependency, product/test source, production export, or other package-owned file changed. Built outputs/coverage are ignored generated files. Final Git readback: ${link('final-state.txt')}.

# 4. Tests

Each observational trial seeds a queued root through public components while stopped, then executes the **unmodified built API** against real SQLite. A separate read-only connection observes parent execution or child admission, the API is killed with SIGKILL, and a new API process recovers the same store. The parent must have exactly one child row and \`child_run.started\`, park on that child, and complete once after its input-waiting child is answered over REST. Nested fixtures add one middle level. Each JSON retains store queries/results, all relevant events, input response, measured delay, kill result and timestamped API log excerpts.

One UNION statement checks both gap directions in a coherent snapshot: child without parent link, and link without matching child row. These finite samples establish **zero observed gaps**, not observation of every instant. Shared-contract SQL-trigger fault cases independently establish rollback. SIGKILL on Windows is hard process termination; JS graceful-shutdown handlers are not claimed to execute.

| Trial | Requested / actual delay | Coherent gap queries | Children at kill | Expected and actual after restart | Result / evidence |
| --- | --- | --- | --- | --- | --- |
${trialRows.join('\n')}

The nine \`sweep-*\` trials anchor on first observed parent \`run.started\`; all landed before child admission on this host. The three \`random-child-*\` trials draw distinct delays with \`crypto.randomInt(1,51)\` and anchor on first observed child. Nested trials anchor on first grandchild. Measured delays disclose scheduling overshoot.

| Check | Steps / expected | Actual | Result and evidence |
| --- | --- | --- | --- |
| 2a before parent park | Public admission wrapper commits child/link, withholds acknowledgement; hard kill; restart built API | Same admitted child; re-park; answer input; one parent completion | PASS; ${link('admitted-before-park.json')} |
| 2b after child finish before node completion | Public event wrapper withholds parent subloop node.finished after child_run.finished; hard kill; built API restart | One child, one child-finish event, one parent-finish event | PASS; ${link('finished-before-node.json')} |
| 2c input after restart | Read observed leaf wait identity; POST input after restart | Each parent level continues once | PASS; trial parked/inputResponse/done fields |
| 3 independent child retry | Fake script fails; parent failure append withheld; kill. Retry child independently, kill again; built API recovers parent | Old failure and new success use fresh wakes, child terminal sequences ${wakes.join(', ')}; last finish records new success | PASS; ${link('failure-before-parent.json')} |
| 3 mapping retry | Built API child succeeds; custom mapping fails; resume parent; query logs | Two mapping failures; one child/start/unchanged child finish | PASS; ${link('mapping-retry.json')} |
| 4 shared admission contract | Run all exported cases on file-backed SQLite, including SQL fault triggers and repeated create | ${contractCount}/${contractCount} pass: rollback, notification/sequence integrity, repeated identity, correctly specified missing-parent refusal | PASS for maintained contract; ${link('admission-results.json')} |
| 4 omitted node negative | Submit missing-parent admission without optional node identity | Orphan admitted | FAIL; QA-D1-001 |
| 5 nested | Kill at grandchild creation for 0/5/25 ms, restart, answer leaf | One child and one continuation at each parent level | PASS; nested JSON files |
| Existing #320 API trials | Coverage suite runs 0/5/25 ms kills with 12 roots and 2 child levels each | 36 roots / 72 parent visits, each one child; no observer gaps in 129,881 snapshots | PASS; ${link('api-coverage.txt')} |
| 6 C6 standalone components | Run awaited-children and subloop-failure files separately | 16/16 engine; 2/2 API | PASS; standalone logs |
| 6 C6 standalone restart suite | Run file alone, original limits | Kill sweep passes; both constructed cases fail in initial 1-second setup poll before crash construction, followed by 60-second cleanup hook timeouts | FAIL; ${link('api-restart-alone.txt')}; subsequent per-case results below |

Precise boundaries are **controlled component-process evidence** using public port injection and real SQLite, then hard kill and built API recovery. The independent-child retry script result is **fake-only**; persistence/process behavior is real. It does not claim live-provider execution or an uncontrolled built API landing on those exact instruction boundaries. No private access/reflection/component monkey-patching/test-only production export. New reproductions ran on this head only; implementer failing-before evidence was read as historical orientation, not independently repeated.

# 5. Gates

The existing suites keep assertions, timeouts, coverage source denominators/exclusions and thresholds. QA-only Vite configuration relocates fixture directory literals to \`gg-qa-320-*\` and API subprocess ports to 5920–5929. The recovery command's ESM loader changes only that script's fixture port range/prefix. No production code is transformed. These are disclosed differences from default fixture locations; see ${link('fixture-locations.mjs')}, ${link('api.config.mjs')}, ${link('infrastructure.config.mjs')}, ${link('recovery-loader.mjs')}.

| Evidence | Exact command | Result (exit code) |
| --- | --- | --- |
${commands.join('\n')}

Engine coverage: **544 passed**, lines **98.10%**, branches **92.36%**, statements **96.91%**, functions **98.69%**. Infrastructure: **616 passed / 16 failed**. API: **694 passed / 9 failed / 6 skipped**. Failed infrastructure/API commands emitted no coverage summary: their thresholds are **not established by this QA run**. No historical percentages substituted.

Infrastructure triage: 7 failures are the brief's known **D-015 native process/tree termination class** (deadline/abort locks, still-writing descendant, script kill/abort timeouts). These descendant cases were not spawned again after leaving locked fixtures. The 9 upgrade timeout cases were tested individually at the original 20 seconds: upgrade-scan and upgrade-alone **1,2,5,6,7,8 pass**; upgrade-alone **3** (hash-bound review) and **4** (changed source/damaged ledger) still time out and remain unresolved. No changed #320 production path is identified in those upgrade checks.

API failures were triaged individually, with original limits: **8/9 isolated checks pass**. The remaining GitHub polling recipe case times out at its original 20-second limit (api-github-alone.txt). Both C6 constructed restart cases, startup/authentication, CLI, version migration, route scopes, catalog admission and template copies pass individually. Full-run failures remain failures even where isolation passes. The whole C6 file was run separately as requested before per-case triage; its hard-kill sweep passed there although it timed out under coverage. No full suite was repeated. Original and isolated logs preserve the distinction between load/setup/cleanup timeouts and failed product assertions.

# 6. Docs

Read QA-COMMON/COMMON, #320, #184, #278 awaited-child/external-effect/test-quality decisions; repository README, issue workflow, architecture snapshot, implementation plan; ADR-0046; docs/05 child-creation/recovery; CHANGELOG #320; implementer report. Docs correctly distinguish atomic admission from exactly-once external effects, retain C6 semantics, state no migration/reset and exclude historical orphan repair. The broad component guarantee needs QA-D1-001 fixed or made truthful. No numbered doc/ADR/CHANGELOG/reference changed. Generated-doc/license/token gates are not applicable: no node/route schema, dependency or web-source change by QA.

# 7. Decisions and parameters

Start delays 0/2/5/10/25/50 plus 7/18/37 ms; three genuinely random post-child delays; nested 0/5/25 ms. Independent harness polling bounds are engineering choices, not owner-approved product settings. Original suite limits retained. Test-fixture locations were adapted to respect the brief. User's explicit temporary-store removal instruction supersedes older generic worker cleanup guidance; host policy still refused the manual retry.

# 8. Caveats and open items

- QA-D1-001 needs implementation/review disposition. Normal REST recovery passing does not satisfy missing-parent refusal for every accepted public admission shape.
- Infrastructure/API coverage gates are not green. Two isolated upgrade cases and the isolated polling recipe timeout need external host verification; D-015 cases require native descendant termination capability.
- Host load was visible: a read-only snapshot measured 78 Node processes using about 9.48 GB working set; one 10 ms target measured 43.47 ms. No attribution to owner/other-worker workloads. CIM process inventory was denied (0x80041003), so native descendant PID ownership could not be verified safely; no global process-name kill was used.
- Independent scenario assertions all passed, but the original process command exited 1 on EBUSY cleanup for \`gg-qa-320-t9taFp\`. Other independent stores report successful removal. Suite-created residual directories: ${link('cleanup-manifest.json')} (**${cleanup.items.length}** at latest inventory), basenames only; cleanup remains incomplete.
- Automatic approval review rejected the explicit path-checked PowerShell removal retry for that known store as **blocked by policy**. No alternative mechanism bypassed this refusal. Remaining cleanup needs orchestrator/host action.
- Final artifact/identity/listener readback is in verification-readback.json. Existing children retain their identity in every observational trial that reached admission and in the four controlled recovery/mapping scenarios. No API listener remains on 5920–5929.
- No browser/live-provider acceptance is claimed; no owner environment change, paid turn, commit or publication occurred.
`,
);
