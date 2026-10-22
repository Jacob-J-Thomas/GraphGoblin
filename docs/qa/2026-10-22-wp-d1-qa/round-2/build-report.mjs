import { readFile, readdir, writeFile } from 'node:fs/promises';
const here = new URL('.', import.meta.url);
const files = await readdir(here);
const read = async (name) => (await readFile(new URL(name, here), 'utf8')).replace(/^\uFEFF/, '');
const json = async (name) => JSON.parse(await read(name));
const link = (name) => `[${name}](${name})`;
const admission = await json('admission-negative.json');
const sqliteContract = await json('admission-results.json');
const fakeContract = await json('admission-fake.json');
const state = await json('final-readback.json');
const trials = [];
let observations = 0;
for (const name of files.filter((n) => /^(sweep-|nested-|random-child-).*\.json$/.test(n)).sort()) {
  const r = await json(name);
  observations += r.observations;
  trials.push(
    `| ${name.replace('.json', '')} | ${r.requestedDelayMs} / ${r.actualDelayMs.toFixed(2)} ms | ${r.observations} | ${r.atKill.runs.length - 1} | One linked child per visit; matching wait after restart; input then one finish per parent | PASS; ${link(name)} |`,
  );
}
const admissionRows = admission
  .filter((r) => r.name)
  .map((r) => {
    const actual = r.actual.failure
      ? `${r.actual.failure.name}, ${r.actual.failure.code}; child=${r.actual.childExists}; events=${r.actual.childEvents.length}`
      : r.name === 'final orphan query'
        ? `gaps=${r.actual.gaps.length}; rows=${r.actual.runs.length}`
        : r.name === 'repeat child with different parent node'
          ? `refused=${r.actual.refused}; existing child/link unchanged`
          : r.name === 'identical admission acknowledgement lost'
            ? 'same child; no extra queued event or parent link'
            : r.name === 'well-formed child'
              ? 'legitimate child queued and linked from parent subloop node'
              : 'unparented root queued with one initial event';
    return `| ${r.name} | ${r.expected} | ${actual} | ${r.pass ? 'PASS' : 'FAIL'} |`;
  });
const commandRows = [],
  nativeRows = [];
for (const name of files.filter((n) => n.endsWith('.txt') && !n.includes('launch-error')).sort()) {
  const content = await read(name),
    command = content.match(/^pnpm\.cmd .*$/m)?.[0];
  if (!command) continue;
  const exit = content.match(/END [^\n]+ EXIT (\d+)/)?.[1];
  const tests = content.match(/^\s*Tests\s+([^\n]+)/m)?.[1]?.trim() ?? '';
  const status = exit === undefined ? 'INCOMPLETE' : exit === '0' ? 'PASS (0)' : `FAIL (${exit})`;
  const row = `| ${link(name)} | \`${command.replaceAll('|', '\\|')}\` | ${status}${tests ? ': ' + tests.replaceAll('|', '/') : ''} |`;
  if (name.startsWith('native-')) {
    const failure = (content.match(/^(?:AssertionError|Error):\s*([^\n]+)/m)?.[1] ?? 'see log')
      .replace(/, rmdir.*$/, '')
      .replaceAll('|', '\\|');
    nativeRows.push(`${row} ${failure} |`);
  } else commandRows.push(row);
}
const coverageRows = [];
for (const pkg of ['engine', 'infrastructure', 'api']) {
  const content = await read(pkg + '-coverage.txt');
  const value = (label) =>
    content.match(new RegExp('^' + label + '\\s*:\\s*([\\d.]+)%', 'm'))?.[1] ?? 'not emitted';
  const tests =
    content
      .match(/^\s*Tests\s+([^\n]+)/m)?.[1]
      ?.trim()
      .replaceAll('|', '/') ?? 'not completed';
  coverageRows.push(
    `| ${pkg} | ${tests} | ${value('Lines')}% | ${value('Branches')}% | ${value('Statements')}% | ${value('Functions')}% |`,
  );
}
const finish = await json('failure-before-parent.json');
const wakes = finish.after.events
  .filter((e) => e.run_id === finish.boundary.parent.id && e.type === 'run.woken')
  .map((e) => e.payload.payload?.childFinishedSeq);
const independentPass =
  admission.filter((r) => r.name).every((r) => r.pass) &&
  state.cases.length === 19 &&
  state.cases.every((r) => r.pass) &&
  sqliteContract.every((r) => r.pass !== false) &&
  fakeContract.every((r) => r.pass);
const title = independentPass
  ? 'PASS for #320 admission and recovery, with the D-015 host limitation below'
  : 'FAIL';
await writeFile(
  new URL('README.md', here),
  `# 1. Branch and worktree

**Verdict for \`58c2cd81870b9e97d885fd31cabc6ed80ce4474a\`: ${title}.** QA-D1-001 is verified fixed. All 19 independent crash/retry scenarios, both 17-case shared admission contracts, all 544 engine tests and all 703 active API tests pass. Infrastructure has 625 passed and seven failed D-015 native-process cases; its command remains exit 1, even though every coverage metric exceeds 90%. This is a qualified functional QA verdict, not a claim that every repository test is green.

Detached HEAD in supplied QA worktree \`<worktree>\`, logical PR branch \`wp-d1-320\`; previous tested head \`05080df2d329688b55be9118f9549b7c0076c203\`. Evidence is uncommitted; no product files, Git index, commits, branch changes or publication. Work performed alone. Node **v22.14.0**, PowerShell, \`pnpm.cmd\`. UTC timestamps in records. Only disposable \`<TEMP>/gg-qa-320-*\` stores and API ports **5920–5929**. No owner app/store or ports 4747/4748 touched; no paid provider turns.

Round-1 evidence is preserved separately: **${state.round1FilesVerified} original files checked by SHA-256; ${state.changedRound1.length} changed**. The original failing diagnostic remains historical evidence for the old head. This round supersedes its verdict only for the new head. See ${link('round-1-before.json')} and ${link('final-readback.json')}.

# 2. Per bolt

**QA-D1-001: fixed and verified.** The same public SQLite admission boundary now refuses a parented admission without a parent node, before any child row/event is written. It also refuses a named node without a parent, a missing parent even when a node is supplied, and a repeat child admission naming a different node. A normal unparented control and a genuine parent/subloop/child graph still admit successfully. Identical lost-acknowledgement admission reuses the child and its one parent link.

The diagnostic reconstructs a frozen admission from a real legitimate child queued through public RunManager methods. Negative variants use fresh identities and change only the parent/node fields, keeping run/thread/queued identity coherent. No private access, reflection, component monkey-patching or test-only product export. Four negative shapes must throw the exported **AdmissionConflictError**, code **WEBHOOK_INTENT_CONFLICT**, leave no run/events, and preserve the existing parent log. The final SQL query must find zero orphans and exactly the two legitimate run rows.

| Diagnostic check | Expected | Actual | Result |
| --- | --- | --- | --- |
${admissionRows.join('\n')}

Steps: run \`node --expose-gc --experimental-import-meta-resolve docs/qa/2026-10-22-wp-d1-qa/round-2/admission-negative.mjs\` with Node 22. All nine checks pass, exit 0. Timestamped actual rows/events and the orphan SQL query are in ${link('admission-negative.json')}; terminal summary in ${link('admission-negative-run.txt')}.

| #320 criterion / round-2 request | Result | Evidence |
| --- | --- | --- |
| One durable child per parent visit through creation/link crash windows | PASS | All 19 independent scenarios below; existing API creation/restart tests in API suite |
| Resume same child after commit/acknowledgement or before parent bookkeeping | PASS | admitted-before-park.json; built API recovery and input completion |
| Parent finish remains once; independent child retry gets a fresh outcome identity | PASS | finished-before-node.json; failure-before-parent.json; mapping-retry.json |
| Refuse missing parent / missing parent node; retain valid control and child | PASS; QA-D1-001 closed on this head | Nine diagnostic checks; shared contract on fake and SQLite |
| Required engine/infrastructure/API coverage suites | Engine/API PASS; infrastructure FAIL, D-015 only | Exact command and percentage tables below; isolated native triage retained |

No new #320 product defect was found. The seven native failures are host-class limitations specified in the brief; they are not silently converted to passes.

# 3. Files changed

Only \`docs/qa/2026-10-22-wp-d1-qa/round-2/\`: copied/adapted QA harnesses, configs, reports, sanitized small text/JSON evidence. No product or repository test source modified. Existing round-1 files remain byte-identical. Ignored build/coverage outputs were regenerated. Final tracked diff is empty: ${link('final-state.txt')}.

# 4. Tests

The full original 19-scenario harness was repeated. Fifteen observational trials execute the **unmodified built API** over real file-backed SQLite; a second read-only connection issues a single coherent UNION query for child-without-link and link-without-child. Hard kill the API at the chosen boundary, await process exit, restart on the same store, require one linked child per parent visit and a matching parent wait, answer the leaf through REST after restart, and require one child finish and one parent finish at each level. Every JSON contains steps' snapshots, identities, events, input response, kill result, measured timing and timestamped API log excerpts.

| Trial | Requested / measured delay | Coherent observer queries | Children at kill | Expected and actual after restart | Result / evidence |
| --- | --- | --- | --- | --- | --- |
${trials.join('\n')}

Observed **${observations}** coherent gap queries across these trials with zero observed gaps. This is finite observation, not observation of every instant. Start sweeps anchor on first observed parent run.started; nested trials on first grandchild; random trials on first child, with distinct random draws from 1–50 ms. Actual timings disclose scheduling overshoot. Existing child identities are also compared before/after in final-readback.json.

| Controlled process check | Steps / expected | Actual | Result / evidence |
| --- | --- | --- | --- |
| Admission committed, acknowledgement lost, before parent park | Public admission wrapper withholds return after commit; SIGKILL; recover in built API; answer input | Same child and link; re-park; one completion | PASS; ${link('admitted-before-park.json')} |
| Child finish recorded, parent node completion interrupted | Public event port withholds subloop node.finished after child_run.finished; SIGKILL; built API restart | One child, one child finish, one parent finish | PASS; ${link('finished-before-node.json')} |
| Independent failed-child retry while parent interrupted | Fake script result fails; block parent failure append; kill; resume child independently to success; kill; built API recovery | Fresh wakes identify terminal sequences ${wakes.join(', ')}; parent records old failure/new success separately and finishes once | PASS; ${link('failure-before-parent.json')} |
| Unchanged child output-mapping retry | Child succeeds; custom parent mapping fails; resume parent | Two mapping failures but one child, one child-start and one unchanged child-finish event | PASS; ${link('mapping-retry.json')} |

Precise boundaries use **public port injection in a built component process**, real SQLite and real hard kills, followed by unmodified built API recovery. They are distinct from uncontrolled timing sweeps. Only script results are fake; persistence/process evidence is real. No provider/live-model behavior is claimed. Windows SIGKILL requests hard termination; graceful JS shutdown handlers are not claimed to execute.

Shared admission contracts: **${sqliteContract.length}/${sqliteContract.length} real file-backed SQLite** cases and **${fakeContract.length}/${fakeContract.length} in-memory fake** cases pass, including the revised missing-node refusal and wrong-node replay assertion, rollback faults, sequence/notification integrity, valid child linkage and repeated same identity. ${link('admission-results.json')}, ${link('admission-fake.json')}. The real fixture uses SQLite fault triggers through public infrastructure exports; each file is closed and removed. Engine/API suites also cover unchanged C6 semantics and the existing nested real-kill trials.

# 5. Gates

All suites retain original assertions, timeouts, source coverage include/exclude lists and thresholds. QA configs set **maxWorkers=2** to bound load and **coverage.reportOnFailure=true** to retain coverage despite known native failures. API fixture-only location transformation uses ports 5920–5929 and gg-qa-320 prefixes. No production source is transformed. Tests use development exports; the separately built process harness uses this head's dist outputs. Coverage commands bypass Turbo caching. Each actual full suite ran once.

| Package | Tests | Lines | Branches | Statements | Functions |
| --- | --- | --- | --- | --- | --- |
${coverageRows.join('\n')}

| Evidence | Exact command | Original result (exit code) |
| --- | --- | --- |
${commandRows.join('\n')}

Infrastructure's seven failures are the brief's **D-015 native process/tree termination class**: three ProcessScripts abort/timeout/UTF-8-cancellation checks, one real child/grandchild cancellation check, and three native Claude transport deadline/abort/descendant checks. Every other infrastructure case passed, including all upgrade cases that timed out in round 1. All seven failures reproduce individually below. No non-D-015 test failure or load timeout occurred in the actual full suites. The full infrastructure command remains failed. Dependency checking exits 0 with its existing no-orphans warning for packages/infrastructure/drizzle.config.ts.

| Native triage evidence | Exact command / expected test assertion | Isolated result | Observed failure |
| --- | --- | --- | --- |
${nativeRows.join('\n')}

Initial suite-launch wrapper error: argument-array transport produced one pnpm argument; all three launches exited 2 **before Vitest or any test ran**. Corrected only the QA wrapper and retained engine/infrastructure/api-coverage-launch-error.txt and their stage JSON files. Those stages were removed. This was a harness launch correction, not a repeated failing full test suite or retry-to-green.

# 6. Docs

Re-read QA-COMMON/COMMON, AGENTS.md, docs/README and issue workflow; compared the new head to the prior tested head. The supplied delta is confined to shared parseRunAdmission, its shared admission contract, and ADR-0046 verification text. ADR now names refusal of a parented admission without a node. Existing docs/05 and CHANGELOG #320 semantics (atomic linkage, finish identity, no migration/reset and no historical orphan repair) remain consistent. No product doc edited by QA. Generated-doc/license/token checks are not applicable: no node/route schema, dependency or web-source change in this delta.

# 7. Decisions and parameters

Full 19 cases rather than a reduced subset. Added explicit root/control, genuine linked-child, identical acknowledgement, inverse missing-parent/node, existing-parent-without-node, wrong-node repeat and orphan-query checks around the original regression. Public interfaces only. Two concurrent suite workers and sequential package suites limit load while preserving original failure limits and truthful coverage. Fault-point wrappers are labelled controlled evidence. SIGKILL instances use only disposable stores; no paid turns. Each suite and isolated native case gets its own gg-qa-320 temporary staging root so cleanup ownership is explicit. No junctions, global process-name kills, owner app access or Git ownership changes.

# 8. Caveats and open items

- The infrastructure command is not green: seven known D-015 cases still require a native host able to establish process-tree termination. Native artifacts are retained as failures; no claim of portable native cancellation acceptance.
- See ${link('final-readback.json')} for cleanup, child identity comparisons, round-1 hashes, no tracked diff, and port readback. Latest residual gg-qa-320 roots: **${state.residuals.length}**. Per-suite/per-case stage JSON records show each cleanup result. No API listener remains on 5920–5929 at final readback.
- No live-provider/browser acceptance is claimed for this backend change; fake-only execution does not establish live-provider behavior. No issue/PR posting, commit or publication was performed.
`,
);
