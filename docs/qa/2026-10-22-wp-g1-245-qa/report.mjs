import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('./', import.meta.url));
const load = async (n) => JSON.parse(await readFile(join(out, n), 'utf8'));
const native = await load('results.json');
const ui = await load('browser-results.json');
const component = await load('component-results.json');
const supplement = await load('supplement-results.json');
const clean = (x) =>
  String(x ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
const link = (f) => `[${f}](${f})`;
let md = `# Independent QA: WP-G1 bolt #245

## Verdict

**FAIL** at \`${native.revision}\`. The replay-seed implementation passed ${native.checks.length} native/API/projection checks over ${native.forks.reduce((s, f) => s + f.events, 0)} event sequences, ${component.checks.length} component checks and ${supplement.checks.length} supplemental checks. All ${ui.sequences.length} selectable browser event states matched the independent reconstruction. The requested append patch display check failed, the browser omitted final delivery events, and the required API coverage run failed a native child-restart assertion. These findings do not show a new seed-reconstruction defect; they prevent a clean overall QA result.

No production code, Git index, commits, branches, or GitHub records were changed. The only added files are in this QA evidence folder.

## Revision, environment and evidence tiers

- Actual QA branch: \`codex-qa-wp-g1-245\`; worktree: \`.claude/worktrees/codex-qa-wp-g1-245\`. HEAD was checked before and after testing and matches the requested revision. Comparison base: \`f69646b7956ea7b90e9cc91d861ddb703ff826cd\`.
- Windows; Node \`${native.node}\` selected before every pnpm command; dependencies already installed. Root build completed before native or browser testing.
- Disposable API: \`${native.origin}\`; data: \`${native.data}\`; API key minted by the built CLI, redacted transcript retained. Only the supported fake harness was injected. Provider behavior is **fake-only**. HTTP, SQLite, process death/restart and Edge are real.
- Edge \`${ui.version}\`, headless installed msedge channel, 1440×1000 and 390×844 viewports. Both layouts were exercised, screenshots retained, and representative desktop/narrow images visually inspected.
- Every native process was a separate built API composition, with the public fake-harness constructor. Queued restart killed the process before the fork started; waiting restart stopped and relaunched it on the same directory; active restart killed a fork during its delayed fake inference turn. Different process IDs are retained in ${link('results.json')}.
- Owner ports 4747/4748 and the owner store were not used. Standard API coverage subprocess tests select their own disposable ports; the independent matrix used 5723 throughout. No directory was deleted. Temporary runtime stores/caches remain for orchestrator cleanup; all cited durable evidence is linked below.

## Systems and comparison method

Touched systems: replay admission and queued event serialization; source-version selection and fork invocation; SQLite initial thread/checkpoint durability; domain-backed web thread projections; inspector first-event, patch, timeline and full JSON views; decision pass counters; node visit display and fresh-entry guard; API error handling and authorization; numbered docs and guide rule.

${link('runner.mjs')} authored a new graph: trigger → initialization → array append → repeat decision (maxPasses 3) → exit. The mutations include array append, scalar replace, scalar add, nested null/boolean values and appended messages. It was not imported from the implementer's fixture. ${link('oracle.mjs')} independently applies RFC 6902 operations and the recorded start/gate/iteration transitions; it never imports domain replay. At **every event sequence**, it compares every top-level field with the real web projection, then reconciles the current HTTP thread and the exact saved SQLite checkpoint at its sequence. Original seeds and patches are also checked for mutation.

Fields compared: \`schemaVersion\`; all \`run\` fields including \`iteration\`; complete \`invocation\`; \`vars\` (including arrays and nested objects); complete \`messages\`; \`outputs\`; \`lastOutput\`; \`artifacts\`; \`counters.nodeVisits\`; \`counters.usage\`; and every gate's \`passes\`. Captured JSON retains complete expected/actual threads, sequence/type, discrepancies, source bytes, checkpoint sequence and queued seed. Current-format iteration stayed 1. Iteration 7→8 was additionally tested only as an explicitly synthetic projection fixture.

The public thread endpoint has no historical-sequence argument. Direct HTTP reads prove queued/current states; historical states are independently reconstructed from the recorded seed/events and anchored to actual checkpoints and the terminal HTTP result. This is **not** a claim that HTTP was synchronously frozen at every intermediate event. Browser selection tests cover every event actually exposed by the timeline; omitted delivery events remain a reported failure.

## Defects

### QA-245-01 — Minor: array append patch rows falsely show absent after

Steps: start the matrix; open the fork \`${native.browser.primaryId}\`; select event 4, the fork's first executed append; inspect the patch rows at either viewport. Expected: \`/vars/items/-\` shows the appended \`"fork-step"\` and \`/messages/-\` shows the appended assistant message. Actual: both rows show \`(absent)\` before **and after**. Concrete replace rows are correct, including count 2→3, and full-thread JSON contains the appended values.

Evidence: ${link('browser-results.json')}, ${link('patch-display.json')}, ${link('1440-append-seed-2-patch.png')}, ${link('390-append-seed-2-patch.png')}. The unchanged \`patchDiff\` pointer interpretation is adjacent #255 scope (\`apps/web/src/runs/projections.ts\`, function \`patchDiff\`); no production fix was made. This directly fails the requested first-node patch-display case even though seed/add/replace reconstruction itself is correct.

### QA-245-02 — Major: required API gate observes duplicate child completion after restart

Steps: with Node 22, run \`pnpm.cmd --filter @graphgoblin/api test:coverage\`. The existing test \`src/subloop-restart.test.ts > awaited subloops across process death (#242) > a hard kill around child completion leaves every parent one continuation after restart\` creates nested leaf/middle/top loops, supplies the leaf input, kills the native API at bounded delays and restarts the same store. Expected: one \`child_run.finished\` per parent. Actual: 2; assertion at \`src/subloop-restart.test.ts:123\`, invoked at line 179. 700 tests passed, 1 failed, 6 skipped. Coverage thresholds could not be certified because this run failed. No retry was performed.

Evidence: ${link('coverage-api.log')}. This is an observed gate failure outside the replay-seed delta, in the #242/#320 continuation/recovery area. Whether it predates the comparison base was not independently measured; no regression provenance or production correction is claimed.

### QA-245-03 — Minor: completed inspector omits the durable delivery tail

Steps: open either successful browser fork and select events through the last available timeline row; reload or open a second viewport. Expected: all events returned by REST remain selectable. Actual: append fork has 17 REST events but 16 timeline events (\`return.delivered\` seq 17 missing); gate fork has 20 REST events but 19 timeline events (seq 20 missing). The timeline says complete. This repeats at both widths and the reload does not add the tail. These omitted events do not change the reconstructed thread.

Evidence: ${link('browser-results.json')} (the four timeline completeness failures), ${link('fork-of-fork-pass-2.json')}, ${link('gate-pass-1.json')}. Observed outside the seed change: \`apps/web/src/runs/useRunEvents.ts\` terminal handling and delivery/finalization history (#258/#116 vicinity). No attribution to this change or repair is claimed.

## Criteria coverage

| Criterion/case | Steps and expected | Actual / outcome | Evidence |
| --- | --- | --- | --- |
| First node after trigger, array mutator, exit | REST replay at init, append and done; compare seed and every sequence; source bytes fixed | PASS; exact inherited state and final API/checkpoints agree | ${link('first-after-trigger.json')}, ${link('array-mutator.json')}, ${link('exit.json')} |
| Gate after 1, 2, 3 passes | Replay API uses first visit of selected node; successive gate/append forks obtain seed passes 1, 2, 3 | PASS; gate seeds [1,2,3]; messages/vars/outputs/visits retained | ${link('gate-pass-1.json')}, ${link('gate-pass-2.json')}, ${link('gate-pass-3.json')} |
| Fork of fork | Alternate gate→append forks to inherit deeper history; all fields compared | PASS; independent ids/invocations and inherited state | ${link('fork-of-fork-pass-2.json')}, ${link('fork-of-fork-pass-3.json')} |
| Concurrent same-source forks | Promise.all two REST replay requests; compare both logs, outputs, state and source bytes | PASS; distinct ids/messages, matching semantic values; timestamps/elapsed times correctly differ | ${link('concurrent-1.json')}, ${link('concurrent-2.json')}, ${link('concurrent-source-bytes.json')}, ${link('component-results.json')} |
| Running/waiting/failed/cancelled source | Script controlled fake turn/input wait/error/cancel; fork with no source mutation | PASS; source HTTP and raw SQLite bytes equal before/after | ${link('running-source.json')}, ${link('waiting-source.json')}, ${link('failed-source.json')}, ${link('cancelled-source.json')} |
| Restart before fork starts | Stop scheduling, admit fork, kill actual process, launch new process/same directory | PASS; seed/event survives and fork succeeds | ${link('first-after-trigger.json')}, ${link('results.json')} |
| Restart midway at input wait | Stop API, relaunch same store, compare seed/current state, submit fork-only answer | PASS; continuation agrees with oracle/API | ${link('waiting-restart.json')}, ${link('waiting-fork-after-restart.json')} |
| Restart during active execution | Kill actual process while fake inference is delayed; restart and reconstruct every event, including new attempt | PASS; seed bytes retained; fork succeeds | ${link('active-restart.json')}, ${link('active-restart-fork.json')} |
| Source record/events/initial/snapshot unchanged | Serialize public record/events/thread and every raw SQLite run/event column before/after each fork or concurrent pair; later re-read terminal sources through read-only SQLite | PASS; exact bytes, including initial_thread/thread_snapshot/thread_snapshot_seq, unchanged during tested fork operations | All *-source-bytes.json plus ${link('supplement-results.json')} |
| Never-reached node | Replay waiting source at done | PASS; 409 REPLAY_NODE_NOT_REACHED | ${link('negative-responses.json')} |
| Node absent from pinned version | Replay invented and ../bad nodes | PASS; 409 REPLAY_NODE_NOT_REACHED (reach check precedes version lookup); unreachable invalid-state branch cannot be reached with valid pins | ${link('negative-responses.json')} |
| Deleted loop run | Complete run, DELETE its loop, replay old id | PASS; 404 RUN_NOT_FOUND; deletion removed run/history | ${link('negative-responses.json')} |
| Malformed/unauthenticated replay | Missing/empty node, malformed JSON, no authorization | PASS; 400 validation/body errors and 401; extra fields are stripped by declared object schema, so an otherwise valid replay returns 202 | ${link('negative-responses.json')}, ${link('supplement-results.json')} |
| Older source lacking recorded seed | Supported REST has no history import/seed-removal interface; current admission always stores initial thread and queues seed | NOT TESTABLE through the running public API; no DB corruption, legacy binary, or private bypass used | Limitation recorded here; no legacy product result claimed |
| Browser first event / selection / reload / two tabs / keyboard | Read full thread JSON, compare each selectable seq with oracle, Enter-select first event, reload, second tab at both widths | PASS for all 96 exposed states; FAIL completeness for missing delivery tail | ${link('browser-results.json')} and all screenshots |
| First-node patch before/after | Inspect append first node; compare concrete replace and append values to API/events | Concrete replacements PASS; array/message append rows FAIL, QA-245-01 | ${link('browser-results.json')}, ${link('390-append-seed-2-patch.png')} |
| maxNodeVisits on a fork | Limit 2; source has inherited append visit 1; fork starts gate twice and append twice, then fails before own gate visit 3 | PASS; displayed append visits 3, gate visits 2; failure accurately says gate would start visit 3 above limit 2; same values in API/JSON | ${link('guard-own-starts.json')}, ${link('1440-guard-failure.png')}, ${link('390-guard-failure.png')} |
| Invalid reconstruction / seed precedence / immutable inputs | Component projection with bad replace path, wrong current values, synthetic iteration | PASS; explained error, recorded seed wins, no fixture mutation | ${link('component-results.json')} |
| Updated docs / CHANGELOG | Read diff of docs 05,09, guide03 and top #245 bullet against measured behavior | Seed and fresh-entry guard descriptions agree; array-diff blanket wording exceeds observed display; existing seedless fork logs are not retroactively repaired | Diff/source reading, QA-245-01 and limitations above |

## Gates and exact commands

Node 22 was first on PATH for every command. Commands ran at the worktree root unless the filter sets the package cwd. No thresholds/exclusions were changed; coverage was run directly in affected packages, without Turbo cache. Docs-generation/license gates were not applicable: no route/schema/dependency change. No broad suite was retried after a product failure.

| Command | Result | Evidence |
| --- | --- | --- |
| pnpm.cmd build | PASS, 11/11 tasks, 2 cached | ${link('build.log')} |
| pnpm.cmd typecheck | PASS, 20/20 tasks | ${link('typecheck.log')} |
| pnpm.cmd lint | PASS, 11/11 tasks; nonfatal shared-cache access warnings | ${link('lint.log')} |
| pnpm.cmd --filter @graphgoblin/engine test:coverage | PASS; 98.01% lines, 92.30% branches | ${link('coverage-engine.log')} |
| pnpm.cmd --filter @graphgoblin/web test:coverage | PASS; 98.94% lines, 94.85% branches | ${link('coverage-web.log')} |
| pnpm.cmd --filter @graphgoblin/api test:coverage | FAIL; 700 passed, 1 failed, 6 skipped; QA-245-02 | ${link('coverage-api.log')} |
| pnpm.cmd check:layers | PASS, exit 0 | ${link('layers.log')} |
| pnpm.cmd check:deps | PASS, exit 0; existing no-orphans warning for infrastructure drizzle.config.ts | ${link('deps.log')} |
| pnpm.cmd check:tokens | PASS, 161 files, exit 0 | ${link('tokens.log')} |
| pnpm.cmd format:check | Initial failures only in new QA artifacts; corrected with scoped prettier formatting; final run PASS | ${link('format.log')}, ${link('format-qa.log')}, ${link('format-final.log')} |
| pnpm.cmd --filter @graphgoblin/web exec tsx ../../docs/qa/2026-10-22-wp-g1-245-qa/runner.mjs | PASS, 209 checks; fake-only provider/native API | ${link('runner.mjs')}, ${link('results.json')} |
| node docs/qa/2026-10-22-wp-g1-245-qa/browser.mjs | Completed; 96/96 selectable states PASS, 6 UI checks FAIL for two defect classes | ${link('browser.mjs')}, ${link('browser-results.json')} |
| pnpm.cmd --filter @graphgoblin/web exec tsx ../../docs/qa/2026-10-22-wp-g1-245-qa/component.mjs | PASS, 10/10 | ${link('component.mjs')}, ${link('component-results.json')} |
| node docs/qa/2026-10-22-wp-g1-245-qa/supplement.mjs | PASS, 6/6 | ${link('supplement.mjs')}, ${link('supplement-results.json')} |
| git diff --check; git rev-parse HEAD; git status --short | PASS; exact head retained; only this untracked QA folder | ${link('final-state.log')} |

## Driver corrections and evidence provenance

The implementation report, before/after JSON and reproduction scripts were read for orientation only; none of their conclusions were reused as independent evidence. The independent driver had setup corrections before its final clean matrix: import-only built entry resolution; killing the queued process instead of attempting a drain with scheduling disabled; only setting JSON content type when sending a body; and accepting the API's declared extra-field/string behavior. A waiting-source comparison initially included a manager restart that merely reordered stored waiting JSON keys; active-source checks were corrected to avoid that recovery intervention and now compare exact bytes. Concurrent decision timestamps/elapsed time were recognized as intentionally independent and tested semantically, with inherited output still byte-equal. These are driver corrections, not retried product failures. The final native matrix has zero failed checks. The API coverage failure was preserved without rerun.

CLI browser startup was blocked first by read-only user cache locations and then a lost daemon connection. Isolated temp npm/daemon/registry settings were tried; no owner installation changed. The retained browser script uses the repository's installed Playwright library in one process and real Edge. The first browser loop exposed missing durable tail events; it was changed to enumerate only present rows **while retaining timeline completeness as failing checks**, not to suppress the defect. No missing event was fabricated. Two zero-patch screenshots are full-thread captures rather than empty patch-list images.

## Every native check

Each row uses the scenario in its name. Steps: run the retained REST/native driver; choose the named seed/source; compare complete JSON/byte values or event sequence reconstructions. Expected: equality with the stated persisted source/seed/oracle, or the explicit limit/error assertion. Actual PASS means exact equality/expected status; the full measured values and sequence count remain in the linked JSON. The scenario matrix above supplies the concrete setup and expected counters.

| System | Case/assertion | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
`;
for (const c of native.checks) {
  const f = native.forks.find((f) => c.name.startsWith(f.label + ':'));
  const evidence = f ? link(f.file) : link('results.json');
  md += `| API/engine/storage/projection | ${clean(c.name)} | Exact stated equality / expected assertion | ${c.status === 'PASS' ? 'Matched' : clean(c.error)}${c.sequences ? '; ' + c.sequences + ' sequences' : ''} | ${c.status} | ${evidence} |\n`;
}
md +=
  '\n## Every browser and supplemental check\n\n| System | Case / steps | Expected | Actual | Result | Evidence |\n| --- | --- | --- | --- | --- | --- |\n';
for (const [system, checks, file] of [
  ['Edge', ui.checks, 'browser-results.json'],
  ['Projection component', component.checks, 'component-results.json'],
  ['REST/read-only SQLite', supplement.checks, 'supplement-results.json'],
]) {
  for (const c of checks)
    md += `| ${system} | ${clean(c.name)} | ${c.expected !== undefined ? clean(JSON.stringify(c.expected)) : 'Exact assertion described above'} | ${c.status === 'PASS' ? 'Matched' : clean(JSON.stringify(c.actual ?? c.error))} | ${c.status} | ${link(file)} |\n`;
}
md +=
  '\n## Every selectable browser sequence\n\nFull field comparison at each selection, same independent oracle and full thread JSON.\n\n| Viewport | Scenario | Sequence/type | Fields differing | Result | Evidence |\n| --- | --- | --- | --- | --- | --- |\n';
for (const s of ui.sequences)
  md += `| ${s.width} px | ${s.label} | ${s.seq}: ${s.type} | ${s.fields.length ? s.fields.join(', ') : 'None'} | ${s.status} | ${link('browser-results.json')} |\n`;
md +=
  '\n## Evidence index (D-028)\n\nEvery retained file in this evidence folder is linked here. SQL captures preserve raw serialized run/event columns as JSON strings, so source byte comparisons can be audited without a mutable database dependency. Screenshots are the real served inspector. No unretained screenshot/log/script is cited as evidence.\n\n';
const files = (await readdir(out)).filter((f) => f !== 'README.md').sort();
for (const f of files) md += `- ${link(f)}\n`;
for (const f of ['format-final.log', 'final-state.log'])
  if (!files.includes(f)) md += `- ${link(f)}\n`;
md +=
  '\n## Observations outside scope and outstanding limits\n\nQA-245-02 (child completion after native restart) and QA-245-03 (delivery-tail visibility) are outside the seed change. QA-245-01 is an unchanged adjacent patch-display implementation owned by #255, but fails an explicitly requested QA case. No production fixes or issue updates were made. No live provider, MCP transport, owner store or historical binary was exercised. A source with an absent repository seed cannot be admitted through supported current APIs; older seedless logs remain untested. Simultaneous source execution was held stable with a delayed fake turn, then explicitly cancelled only after its fork comparison. Gate/iteration state beyond naturally reachable current-format values is labelled synthetic. The final temporary API process was stopped after the browser and read-only checks; directories remain for orchestrator cleanup.\n';
await writeFile(join(out, 'README.md'), md);
