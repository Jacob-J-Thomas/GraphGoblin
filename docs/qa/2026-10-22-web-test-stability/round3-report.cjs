const fs = require('node:fs');
const path = require('node:path');
const out = path.join(process.env.TEMP, 'gg-chore-web-round3-after');
const folder = 'docs/qa/2026-10-22-web-test-stability';
const summary = JSON.parse(fs.readFileSync(path.join(process.env.TEMP, 'gg-chore-web-round3-summary.json'), 'utf8'));
function evidence(phase, file) { return 'round3-' + phase + '-' + file; }
function run(phase, file) {
  const row = summary.find(row => row.phase === phase && row.file === file);
  if (!row || !row.summary.length) throw new Error('Missing complete summary: ' + phase + ':' + file);
  const name = evidence(phase, file);
  return '[' + name + '](' + name + ')\n\n```text\n' + row.summary.join('\n') + '\n```\n' + (row.coverage.length ? '\n```text\n' + row.coverage.join('\n') + '\n```\n' : '\nCoverage was not emitted.\n');
}
function matrix(phase) { return ['verified-parallel-1.log.txt', 'verified-parallel-2.log.txt', 'verified-serial.log.txt'].map(file => run(phase, file)).join('\n'); }
const gates = [];
for (const name of ['typecheck-results.json', 'typecheck-2-results.json', 'layers-results.json']) {
  if (fs.existsSync(path.join(out, name))) gates.push(...JSON.parse(fs.readFileSync(path.join(out, name), 'utf8')));
}
const gateTable = gates.filter(row => row.command.startsWith('pnpm.cmd ')).map(row => '| `' + row.command + '` | ' + (row.code === 0 ? 'PASS' : 'FAIL') + ' (exit ' + row.code + '), ' + row.wallSeconds + ' s | [' + row.name + '](' + evidence('after', row.name + '.log.txt') + ') |').join('\n');
const results = JSON.parse(fs.readFileSync(path.join(out, 'verified-matrix-results.json'), 'utf8'));
if (results.length !== 3 || results.some(row => row.code !== 0)) throw new Error('Matrix must be complete and green before final report');
const text = `# Web test stability: round 3

## 1. Branch and worktree

Base and current HEAD: \`b06832a969cccf218dbbeb30305250ef5ad8d3c1\`.
Live branch: \`codex-chore-web-test-stability\`; no branch switch was performed.
Worktree: .claude/worktrees/codex-chore-web-test-stability, relative to the repository.
Uncommitted; ready for orchestrator commit. Node 22.14.0, Windows, 12 logical processors.
No product source, Vitest configuration, threshold, exclusion, test timeout or expectation changed.

## 2. Per bolt

This is PR #384 repository hygiene for D-029/D-032, rather than a roadmap bolt.

- **Observation ordering: corrected and measured.** The exact auditor driver ran before changes and after the four test edits. The final two parallel executions and serial execution all passed with coverage. No execution was retried on unchanged test source to obtain acceptance.
- **Provenance: reproduced and corrected.** The historical capture hashes differ from HEAD in exactly 16/29 and 2/110 entries. Manual byte normalization reconstructs every existing HEAD blob. Both manifests now label the capture hashes and add committed-byte SHA-256 and Git blob IDs for every entry. Original fields and redaction notes are unchanged.
- **Evidence retention:** new raw captures use the round3 prefix and repository-relative citations, with local user paths redacted. Logs use the .log.txt extension. The manifests describe the capture/redaction/normalization stages. The final reference check is captured in [round3-after-refs-check.log.txt](round3-after-refs-check.log.txt).

## 3. Files changed

Shared web test files, all within this hygiene scope; no production regions owned by other WAVE packages were edited:

| File | Changed lines | Observation |
| --- | --- | --- |
| apps/web/src/editor/EditorPage.restore.test.tsx | 2, 127–129 | Await removal of public Loading loop state before the restored heading; all archive, conversion and overwrite assertions remain. |
| apps/web/src/editor/EditorPage.test.tsx | 1095–1097 | Await absence of the server-newer notice after asynchronous Discard; retain the persisted-deletion assertion. |
| apps/web/src/styles/code-theme.test.ts | 8, 55–66 | Recollect the public token DOM until the four original class/value assertions pass together. |
| apps/web/src/editor/useLoadEditor.test.tsx | 165–174 | Additional ordinary-run failure: remove the fixed 60 ms sleep and await the original persisted-description assertion. |

QA record changes: both historical provenance manifests (new fields throughout; first entry at lines 8–11 and 7–10), the record [README](README.md), this report, [round3-evidence-provenance.json](round3-evidence-provenance.json), and its listed round3 captures and verification scripts. No shared numbered product document changed in this round.

## 4. Tests

### Reproductions before the change

The independent audit ran on this exact HEAD. Its first parallel execution failed three tests, and serial reproduced Discard. These retained audit results remain failures:

${matrix('audit')}

The audit's restore failure was \`Unable to find role="heading" and name "legacy device copy"\` (6,428 ms). Discard reported \`expected <p …></p> to be null\` while showing the server-newer notice. The token assertion expected \`['gg-tok-string', '"loop"']\` but its snapshot held only \`['gg-tok-property', '"name"']\`.

This thread's unchanged full matrix did not reproduce those intermittent loaded failures. All three executions below are negative reproductions, rather than evidence that invalidates the audit:

${matrix('before')}

Two controlled timing probes then reproduced the exact immediate-snapshot assertions before edits. A public storage dependency delayed real Discard deletion by 200 ms; an advancing Date clock exhausted CodeMirror's initial parsing budget only during construction, then restored real time. There was no production edit, private parser access or component patch. The same probes passed after the observation changes:

${run('before', 'controlled-probes-selected.log.txt')}

Before failure quotes:

\`AssertionError: expected <p …(1)></p> to be null\`, received “The server has a newer draft”.

\`AssertionError: expected [ [ 'gg-tok-property', '"name"' ] ] to deep equally contain [ 'gg-tok-string', '"loop"' ]\`.

${run('after', 'controlled-probes-selected.log.txt')}

[Probe generator](round3-probes.cjs), [initial temporary config](round3-probes.config.mjs), and [working probe config](round3-after-gg-chore-web-round3-probes.config.mjs) are retained. Harness failures are separate: two configurations failed before tests with EPERM while Vite attempted its temporary bundle outside the writable worktree ([first](round3-before-controlled-probes.log.txt), [second](round3-before-controlled-probes-corrected.log.txt)); the next command selected no tests ([75 files / 964 cases skipped](round3-before-controlled-probes-bound-config.log.txt)). None counts as a passing reproduction. Moving the config into the worktree and setting the exact selection in that diagnostic config produced the valid two-case runs above. The temporary config was removed before gates.

### Additional failure and correction

The first ordinary coverage gate failed; coverage was not emitted:

${run('after', 'ordinary.log.txt')}

\`useLoadEditor.test.tsx:170\`, “gates saves, preserves edits and uses the loaded base token (synced=true)”, failed in 102 ms: \`expected undefined to be 'edited during read'\`. A fixed 60 ms delay followed by a server-gated flush did not establish device-write completion. The fourth test edit awaits that same stored value. Its server gate, no-PUT assertion, retained editor content and If-Match check remain. Typecheck, lint, format and ordinary coverage were rerun because this source changed:

${run('after', 'ordinary-2.log.txt')}

### Final loaded matrix — every execution

The [auditor driver](round3-after-run-matrix.cjs) is byte-identical to the before copy and supplied audit script. It runs two default-parallel coverage invocations followed by one with \`--maxWorkers=1\`, starts three busy workers before each invocation, and terminates those workers afterwards. No argument, worker policy, recovery timer or timeout was changed. Each actual child exit code is checked independently of the driver's parent exit code. Exact child commands (the first runs twice):

\`pnpm.cmd --filter @graphgoblin/web test:coverage --reporter=verbose\`

\`pnpm.cmd --filter @graphgoblin/web test:coverage --reporter=verbose --maxWorkers=1\`

${matrix('after')}

[Matrix metadata](round3-after-verified-matrix-results.json) records exit codes, wall time and load CPU time. [All-run summaries](round3-summary.json) preserve readable verbatim summary lines and target timings. [Assertion inventory](round3-assertions.json) retains all **470 original assertions**, with zero missing and zero additions, across the four files. [Source binding](round3-source-binding.json) binds the final four tests and seven production/configuration inputs to their post-format hashes; [earlier binding](round3-after-attempt1-source-binding.json) preserves the first ordinary attempt's inputs.

After building the app, the relevant served Edge specs for drafts and the editor modal passed **14/14**, with zero retries, in **48.3 seconds**. The real API used disposable in-memory stores and fake provider harnesses. [Browser transcript](round3-after-browser.log.txt). This includes seeded format-3 draft restoration, restore/reload notices, two-tab conflicts, modal keyboard/focus, responsive layout and save/conflict handling; it does not claim live-provider validation.

## 5. Gates

All commands ran from the worktree root with Node 22 first on PATH and pnpm.cmd. The failed ordinary gate remains a failure in the table. The second typecheck/lint/format sequence followed the fourth test edit. Web tasks ran fresh; unchanged Turbo tasks used cache. Typecheck/lint emitted a non-fatal \`WARNING IO error: Access is denied. (os error 5)\` after successful task completion, retained in the transcripts.

| Command | Result | Transcript |
| --- | --- | --- |
${gateTable}

For the matrix command, the three child results above determine acceptance; its parent alone is not a passing gate. The browser command used a temporary gg-chore-web-round3-playwright.config.ts, removed after execution; its [retained configuration](round3-after-gg-chore-web-round3-playwright.config.ts) and [harness generator](round3-browser.cjs) remain in this record. Final record formatting and \`pnpm.cmd format:check\` have separate transcripts: [format](round3-after-record-format.log.txt), [format check](round3-after-format-check.log.txt). The final record validation additionally checks source hashes, addable filenames, local-path redaction, committed-byte hashes, exact driver copies and all three matrix child exits. [Validation](round3-after-record-verify.log.txt).

## 6. Docs

The record README explains capture hashes, redaction, Git normalization, committed SHA-256 and Git blob IDs. Earlier before/after/round2 documents and their evidence bytes remain intact. The numbered workflow's retention rule and the existing raw-evidence Prettier exclusions remain unchanged. No product behavior, schema, route, dependency or decision changed, so no product CHANGELOG, generated reference or ADR update is required.

## 7. Decisions and parameters

- Restore first captures an actually mounted public loading element and waits for its removal. The heading assertion then queries the restored editor after that phase, rather than spending its observation window on the loading tree. The heading and every storage/conversion assertion remain independent checks. The audit's restore failure was not independently reproduced by this thread; this is its explicitly requested observation correction, verified in the final loaded matrix.
- A user-event click awaits event dispatch, not every asynchronous handler operation. Discard now awaits the notice removal that production performs after durable deletion; its separate persisted-data check still guards the deletion.
- CodeMirror may finish parsing on a later task once its initial real-time budget is spent. Each token observation builds a new snapshot and checks all four original expected pairs in one callback. A missing or wrong token continues to fail; no parser completion is forced through a private interface.
- A server-gated flush returns false without awaiting the independent device mirror. The fourth case now awaits its original public storage value, rather than guessing completion after 60 ms. It continues to edit while the server read is held and verifies the same save/token behavior after release.
- All observations use the existing Testing Library deadline and existing per-test budgets. No retries, fixed sleeps, wider timeouts, skipped cases or expectation changes were introduced. The final matrix measures the specified load; it is not a claim about unlimited machine stalls.
- Both historical manifests preserve every original field and append \`captureHashScope\`, \`committedSha256\`, \`committedGitBlob\` and \`gitNormalization\`. \`originalSha256\` and \`retainedSha256\` remain hashes of captured bytes at their documented redaction stages. Thus the historical capture-versus-blob differences intentionally remain 18; the new committed-byte comparison has zero mismatches.
- [Provenance reproduction](round3-before-provenance-before.json) and [independent verification](round3-provenance-verify.json) cover all 139 historical entries. [Verifier](round3-provenance.cjs) reads \`git ls-files --eol\`, removes only CR bytes immediately preceding LF for Git text, preserves binary bytes, computes SHA-256, and invokes \`git hash-object --no-filters --stdin\`. It compares that result with Git's independent \`hash-object --path\` clean conversion and the actual HEAD blob, including full byte equality. No object or index is written. [Audit normalization reconstruction](round3-audit-hash-cause.json) is retained separately.
- New round3 captures use the same capture/committed distinction; their committed fields predict the orchestrator's future blobs and are independently compared with Git clean conversion. Mutable Markdown reports and the provenance manifest itself are authored records, not self-hashed raw captures. [Retainer](round3-retain.cjs) strips user-directory prefixes/username in UTF-8 and UTF-16LE before recording retained hashes. [Record verifier](round3-verify-record.cjs) checks the retained files.
- The required real formatter runs preserved all 58 snapshotted raw artifacts. [Snapshot](round3-raw-before.json), [first check](round3-after-raw-check.log.txt), [second check](round3-after-raw-check-2.log.txt). The browser harness uses only disposable test services on ports 5770–5772 and zero retries; its generated files are removed individually after the run. The allowed-port shutdown probe is retained in [round3-ports.json](round3-ports.json).

## 8. Caveats and open items

The restore heading failure was reported by the audit at this exact HEAD, but not reproduced in this thread's unchanged matrix; both accounts are preserved. Two controlled failures and the additional ordinary coverage failure were reproduced and corrected. Every failed or invalid attempt is retained and labelled, rather than converted to green by a later pass.

No product race was established, and no product code was edited. Work was performed alone in this worktree. No commit, staging, push, merge, rebase, stash, branch switch, directory-deletion command, dependency link or owner app/store operation was performed. Browser data directories with the gg-chore-web-round3-api prefix, and generated coverage/report directories, are retained for the orchestrator; only explicitly named temporary source files are removed. The new files are addable under tracked-compatible names; the orchestrator must commit them. Final tested-source hashes must be reconciled with that new commit before Fable review and the resumed exact-head audit. Those external review/commit steps remain open.
`;
fs.writeFileSync(folder + '/round3.md', text);
console.log(JSON.stringify({report: folder + '/round3.md', loadedExecutions: results.length, assertionsPreserved: 470}));
