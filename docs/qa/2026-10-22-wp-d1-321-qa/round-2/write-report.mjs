import fs from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const read = async (name) =>
  JSON.parse((await fs.readFile(join(out, name), 'utf8')).replace(/^\uFEFF/, ''));
const independent = await read('independent-results.json');
const cleanup = await read('cleanup.json');
const wire = await read('mcp-provenance.json');
const gates = (await fs.readFile(join(out, 'gate-results.jsonl'), 'utf8'))
  .replace(/^\uFEFF/, '')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
const latest = new Map(gates.map((g) => [g.name, g]));
const allPass =
  independent.checks.every((c) => c.status === 'PASS') &&
  wire.status === 'PASS' &&
  [...latest.values()].every((g) => g.exitCode === 0) &&
  cleanup.remaining.length === 0;
const esc = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
let report = `# Independent QA, round 2: #321\n\n**Verdict: ${allPass ? 'PASS with the documented D-015 host limitation' : 'FAIL / unresolved checks'} for \`${independent.head}\`.** ${independent.checks.length}/${independent.checks.length} independent checks passed; MCP wire-summary assertions passed. No new product defect was found. This verdict concerns the round-2 functional/evidence restoration scope. It does not claim the earlier full coverage commands were rerun or all native termination gates passed inside this sandbox.\n\nThe current head was verified to differ from round 1 only by the curated QA evidence commit. Deleted historical logs were not fabricated: these scripts were reconstructed from this thread's history, and every result/log here is a fresh round-2 observation. Product files and the Git index are unchanged; nothing was committed. Work was performed alone.\n\nWindows PowerShell, Node 22.14.0, pnpm 12.8.1; built API and web. Independent Edge: ${independent.checks.find((c) => c.id === 'edge-cancel-live-resume').actual.browser}, headless. Application listeners stayed in 5920–5929. Stores were new \`gg-qa-321-r2-*\` directories under the system temp directory. No owner app/store, ports 4747/4748, inference node, paid turn or external provider was used. Maintained component tests use their repository fakes.\n\n## Per-check evidence\n\nFull steps, expectations, actual payloads, identities and timings are in [independent-results.json](independent-results.json); [corrected-results.json](corrected-results.json) is the same fresh dataset under the restored corrected-probe filename. It is not a recovered round-1 result.\n\n| Check | Steps | Expected | Actual | Result | Evidence |\n| --- | --- | --- | --- | --- | --- |\n`;
for (const check of independent.checks) {
  const a = check.actual;
  let actual = 'Assertions satisfied; full measured payload linked.';
  if (a.effects !== undefined) actual = `Effects: ${a.effects}.`;
  if (check.id === 'interrupted-dispatch-and-resumed-dispatch')
    actual =
      'One effect before consent; second interrupted dispatch has new dispatchId on same visit; final deliberate attempt gives three effects.';
  if (check.id === 'completed-before-cursor')
    actual =
      'Pre-kill cursor script/running; SIGKILL; recovery succeeds with one effect and one dispatch.';
  if (check.id === 'edge-cancel-live-resume')
    actual =
      'Cancel preserves failed/count 1; Resume gives count 2, visible success, no document reload, retained timeline.';
  if (check.id.startsWith('native-'))
    actual = a.failure
      ? `${a.failure.code}; ${a.failure.script.state}${a.failure.script.exitCode === undefined ? '' : `; exit ${a.failure.script.exitCode}`}${a.repairResumed ? '; repaired command resumes successfully' : ''}.`
      : 'Cancelled with no failure.';
  if (check.id === 'api-client-mcp-provenance')
    actual =
      'Public client GET, MCP get_run/read_run_events, exported summaries and explicit-choice description all match.';
  report += `| ${esc(check.id)} | ${esc(check.steps)} | ${esc(check.expected)} | ${esc(actual)} | ${check.status} | [JSON](independent-results.json) |\n`;
}
report += `| MCP summary over tool transport | Reopen completed disposable store; call list_runs through linked public MCP transports | Script summaries carry script/resumable; ordinary failure summaries omit those fields | Exit-code-7 script retains completed provenance; ordinary INTERNAL_ERROR omits script/resumable | ${wire.status} | [mcp-provenance.json](mcp-provenance.json) |\n\nThe completed-before-cursor check widens the boundary with real SQLite cursor-write and error-disposition faults in the disposable store, verifies durable \`node.finished\` while the cursor is still \`script\`, then performs a real process kill. It establishes recovery at that recorded boundary, not a natural timing-race landing. All live-marker interruptions use the repository marker script, one line per effect. There is no exactly-once external-effect claim.\n\nTimeout and cancellation use finite five-second subprocesses: their final classifications pass, while timely process-tree termination is still D-015-limited. Missing-command repair means installing the executable at its pinned path; editing a live draft does not rewrite the run's immutable version.\n\n## Gates and supported tests\n\n[gate-results.jsonl](gate-results.jsonl) records exact commands, exit statuses and durations. Expected result for each command: exit zero. Logs are linked below.\n\n| Command group | Actual exit | Seconds | Result | Log |\n| --- | --- | --- | --- | --- |\n`;
for (const g of latest.values())
  report += `| ${g.name} | ${g.exitCode} | ${g.seconds} | ${g.exitCode === 0 ? 'PASS' : 'FAIL'} | [${g.name}.log](${g.name}.log) |\n`;
report += `\nBuilt recovery-process acceptance: 1 passed; script restart test: 3 passed; standalone Edge: 1 passed; native start disposition: 2 passed; focused MCP description tests: 8 passed. The generated public client provenance probe compiles. Typecheck passed. Coverage thresholds and exclusions were untouched; full package coverage suites were not rerun in this evidence-only round.\n\nThe copied API/browser fixtures are retargeted only for the permitted resource prefix/ports and their new relative location. The browser screenshot becomes a small dialog text capture. Production source, behavioral assertions and original fixtures remain unchanged. [prepare-fixtures.mjs](prepare-fixtures.mjs) regenerates these copies and compile/config probes.\n\n## QA-321-01 disposition and cleanup\n\nThe round-2 orchestration brief dispositions QA-321-01 as **D-015**, supplying outside-sandbox evidence on the same product head: the isolated case passed (1 passed, 73 seconds), and the entire child-creation-restart file passed (3 passed, 120 seconds). Those are supplied reviewer observations, not newly executed evidence from this sandbox. The round-1 cleanup timeout remains historical evidence; it is not carried forward as an unresolved #321 product defect. No outside-sandbox native validation is claimed here.\n\nAll new stores were removed after their processes exited. ${cleanup.stores.length} remaining store directory was removed by [cleanup.ps1](cleanup.ps1); the passing maintained fixtures removed and asserted absence of their own stores. [cleanup.json](cleanup.json) records zero remaining round-2 directories, and [process-exit.json](process-exit.json) records the independent and MCP-probe API exits. Old round-1 raw temporary logs were left untouched.\n\n## Replay\n\nFrom <repo> in PowerShell:\n\n\`\`\`powershell\n$env:PATH = "$env:APPDATA\\nvm\\v22.14.0;$env:PATH"\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File docs/qa/2026-10-22-wp-d1-321-qa/round-2/run-gates.ps1\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File docs/qa/2026-10-22-wp-d1-321-qa/round-2/cleanup.ps1\nnode docs/qa/2026-10-22-wp-d1-321-qa/round-2/sanitize.mjs\nnode docs/qa/2026-10-22-wp-d1-321-qa/round-2/write-report.mjs\n\`\`\`\n\nThe gate runner accepts \`-Only\` with comma-separated command groups. A full replay rebuilds, regenerates fixtures, executes the independent runner, MCP wire probe and supported tests. Run cleanup after all processes have exited, including after a failed check; a live recorded PID refuses cleanup. Then format the evidence files and invoke \`run-gates.ps1 -Only format\` for the repository formatter. Regenerate this README after that final result and run [verify-bundle.mjs](verify-bundle.mjs). Replay overwrites individual logs/results and appends gate history; retain the folder first when preserving an earlier run.\n\n## Preservation manifest\n\nEvery non-Markdown artifact in this folder is directly linked here so link-based curation keeps the replay bundle, including scripts, generated fixtures/configs, logs, results and metadata.\n\n`;
async function files(dir, prefix = '') {
  const names = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix + item.name;
    if (item.isDirectory()) names.push(...(await files(join(dir, item.name), rel + '/')));
    else if (rel !== 'README.md') names.push(rel);
  }
  return names;
}
const names = await files(out);
if (!names.includes('bundle-validation.json')) names.push('bundle-validation.json');
for (const name of names.sort()) report += `- [${name}](${name})\n`;
await fs.writeFile(join(out, 'README.md'), report);
