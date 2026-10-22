import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { execFileSync } from 'node:child_process';
const folder = 'docs/qa/2026-10-21-wp-d2-qa/';
let report = await readFile(folder + 'README.md', 'utf8');
report = report.replace(
  '**Targeted acceptance PASS (25 independent native cases plus the archived-store upgrade); overall required-suite verdict pending completion.**',
  '**FAIL for the overall QA gate: infrastructure and API coverage are red. Targeted #246 acceptance PASSED (25 independent native cases, archived-store upgrade, three built-process acceptances and both Edge specs).**',
);
report = report.replace(
  'isolated triage is reported below when available.',
  'isolated triage also failed the same test and cleanup hook (1 passed / 1 failed); see client-template-triage.log.',
);
report = report.replace(
  'Browser/native/suite outcomes still pending are not implied passed.',
  'All explicitly requested suites completed. No broad suite was rerun.',
);
report = report.replace(
  'The first root format check failed only native.json, a QA artifact updated during the run.',
  'The first root format check failed only native.json, a QA artifact updated during the run.',
);
report += `

### Final suite findings and severity

No confirmed WP-D2 functional defect was found. The following are **validation blockers**, not assertions that a new webhook regression was reproduced:

1. **Major validation blocker — API suite remains red.** Full coverage: 698 passed, 4 failed, 6 skipped; lines 97.83%, branches 92.95%. Failures were the three cases in subloop-restart.test.ts (180 s hard-kill test timeout; constructed child absent/running instead of waiting; 60 s cleanup hooks) and the first controlled GitHub recipe case (20 s timeout). One bounded isolated run, without coverage and with one worker, gave 7 passed / 1 failed across those two files. All eight hard-kill landings, parent-mid-wake recovery and all five recipe cases passed; “the built API recovers a child finished while down with one continuation per parent” failed its 60 s afterEach cleanup hook. The hook failure is reproduced independently of full-suite concurrency. Cause remains unresolved in this sandbox; no new outside-sandbox pass is claimed. See api.log and api-failure-triage.log. The full run is retained as FAIL.
2. **Major validation blocker — infrastructure D-015 cases.** Seven named failures remain as listed above; the high coverage percentages do not turn the command green. The existing D-015 classification is historical context, not fresh proof about host causality or an exemption.
3. **Minor outside-scope validation defect — client template test timeout.** The 5 s test and 10 s cleanup hook fail both in the full client suite (70/71) and a single-file one-worker triage (1/2). No webhook-delivery assertion failed. This is not labelled disproven or cleared by a retry. See api-client.log and client-template-triage.log.

Other results: engine coverage 555 passed, lines 98.05%, branches 92.46%; Edge 2/2 passed with retries zero; webhook-retry, recovery-process and wait-restart all passed. The supplied Edge specs verify the inspector changes a pending delivery to delivered without reload while execution stays succeeded, and the published inbound receiver address creates exactly one run with the submitted JSON.

Exact additional triage commands:

- pnpm.cmd --filter @graphgoblin/api-client exec vitest run src/templates.test.ts --maxWorkers=1 — FAIL, 1 passed / 1 failed.
- pnpm.cmd --filter @graphgoblin/api exec vitest run src/subloop-restart.test.ts src/triggers/github-recipe.test.ts --maxWorkers=1 — FAIL, 7 passed / 1 failed (cleanup hook).

The built wait/restart suite reports its actual temporary stores in wait-restart.log (both polling rates), and recovery-process.log explicitly reports removal. The stock webhook-retry script does not print its generated store basename; its finally cleanup ran on its successful exit. These repository commands retain their existing port/prefix allocation; the independent new drivers use only 5810–5819 and gg-qa-246 stores.

The API recipe tests deliberately retain SQLite fixtures under the worktree's .tmp folder. All **ten** created by the full run plus narrow triage were inventoried, checked to contain only the known synthetic recipe files and gg.db, and removed. Exact manifests and successful deletion results are in suite-store-cleanup.json. Its remainingOwnTempEntries lists only the archived source export and source manifest, not a store. The native/upgrade cleanup records are independent. No current owner or other worker directory was included.
`;
await writeFile(folder + 'README.md', report);
const ports = [];
for (let port = 5810; port <= 5819; port++) {
  const open = await new Promise((ok) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      ok(true);
    });
    socket.once('error', () => {
      socket.destroy();
      ok(false);
    });
    socket.setTimeout(1500, () => {
      socket.destroy();
      ok('timeout');
    });
  });
  ports.push({ port, open });
}
const environment = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  node: process.version,
  platform: process.platform,
  manualPortsAfterCleanup: ports,
  workspaceTemporaryDirectoriesAfterCleanup: await readdir('.tmp'),
  evidenceOnlyGitStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim(),
  oldSourceEmission: {
    commit: '52360d99def690d3cff9f36cc81a76b48c172582',
    emittedFiles: 384,
    lockfileIdenticalToHead: true,
  },
  sourceArchiveCleanup: {
    removed: false,
    reason:
      'Automatic approval review: blocked by policy; non-store archive retained under COMMON.',
  },
};
await writeFile(folder + 'environment.json', JSON.stringify(environment, null, 2) + '\n');
