import { readFile, writeFile } from 'node:fs/promises';
const dir = 'docs/qa/2026-10-22-wp-g2-qa';
let s = await readFile(dir + '/REPORT.md', 'utf8');
s = s.replace(
  'FAIL (infrastructure full suite red; frozen install host-blocked). Remaining suite counts and isolated triage are recorded below.',
  'FAIL (infrastructure and web full suites red; frozen install host-blocked). All requested runs and isolated triage are complete.',
);
s = s.replace(
  'All stores are confined under the QA temporary root. Cleanup remains to be completed after suites.',
  'All stores were confined under the QA temporary root. Cleanup passed: the root was removed, including63 database files; assigned QA listeners are closed. See cleanup.txt and cleanup-inventory.txt.',
);
s = s.replace(
  'No new product defect is confirmed in the paging/summary changes.',
  'The audit finding is FIX VERIFIED on this head. No remaining product defect was reproduced within #231/#236, so no new product-defect severity is assigned. Required test gates remain failed as detailed below.',
);
s = s.replace(
  /The infrastructure failures comprise[\s\S]*?(?=\n## 5\. Gates)/,
  'The infrastructure full-run failures comprise seven native process-tree cases (D-015) and fifteen20-second upgrade deadlines. Web had seven20-second deadlines and eight restoration assertions. All37 failures were exercised alone after all full suites finished, with exactly one selected test per command and unchanged timeouts/assertions.\n\n**Isolated results:30 passed,7 failed.** All15 upgrade cases and all15 web cases passed alone. The seven native cases still failed through cancellation/deadline/marker assertions and busy fixture cleanup. Full-run timeouts are classified as load/deadline failures; the restoration assertions were not reproduced individually and remain a full-run timing/order concern. This does not resolve either failed full suite.\n\nEvery isolated check includes its file/title, steps, expected, full-run actual, isolated actual, selected count, result and evidence in [triage.md](triage.md) and [triage-results.json](triage-results.json). Exact full-suite commands and counts are in [suites.json](suites.json). The duplicate descendant failure header was a test plus its cleanup error, not an extra test.\n\nThe first selector attempt selected zero tests in37 collection-only commands; all are excluded from pass totals and preserved as selector-miss-*.txt. The corrected title-word selectors executed exactly one intended case each; no product assertion or timeout was changed, and no broad suite was rerun.\n',
);
s = s.replace(
  'all coverage thresholds pass; isolated triage follows',
  'all coverage thresholds pass; isolated triage complete:30 pass/7 D-015 failures',
);
s = s.replace(
  'subsequent QA artifacts receive scoped formatting verification',
  'subsequent QA artifacts also pass scoped formatting verification',
);
s = s.replace(
  'Full-suite failures remain failures even if a targeted isolated run passes; those cases are classified as load/deadline evidence, not retry-to-green.',
  'Full-suite failures remain failures. The15 upgrade deadlines and seven web deadlines passed alone (load/deadline class); eight full-run restoration assertions also passed alone and remain a timing/order concern. No passing isolated result is substituted for a failed gate.',
);
s = s.replace(
  'Temporary-root removal and final tracked-file/index verification remain pending until the suites finish.',
  'Cleanup is complete:63 database files and the full QA temp root removed; all four assigned listeners closed. Final HEAD remains9896cf769fb46fd9a474c7de2a20078971eda9a2, tracked diff and index diff are empty, and only this QA folder is untracked. No work remains running from this QA.',
);
s = s.replace('All live fixture loops', 'All native fixture loops');
s = s.replace(
  'an optional clarification was requested while other work continued.',
  'An optional clarification was requested while other work continued.',
);
s = s.replace(
  'An optional clarification was requested while other work continued.',
  'No clarification arrived during this run. If the brief literally requires skipping a rejected malformed inbound page, that condition is not met; the successful empty-page continuation check is controlled-response evidence, not a production malformed-row skip.',
);
const words = [
  'Node',
  'Edge',
  'was',
  'on',
  'control',
  'at',
  'typed',
  'first',
  'final',
  'page',
  'seq',
  'nextAfter',
  'it',
  'restore',
  'corruption',
  'inspector',
  'beyond',
  'count',
  'all',
  'retains',
  'reaches',
  'and',
  'to',
  'solid',
  'opacity',
  'produce',
  'row',
  'appends',
  'passed',
  'lines',
  'Line',
  'migration',
  'docs',
  'guide',
  'including',
  'seven',
  'fifteen',
];
s = s.replace(new RegExp('\\b(' + words.join('|') + ')(?=\\d)', 'g'), '$1 ');
s = s.replace(/\b(PASS|FAIL):(?=\d)/g, '$1: ').replace(/,(?=\d)/g, ', ');
s = s
  .replace('PASS11/11', 'PASS: 11/11')
  .replace('PASS3/3', 'PASS: 3/3')
  .replace('retries0', 'retries 0')
  .replace('1465', '1465');
s = s.replace(
  'No work remains running from this QA.',
  'No QA command remains running; owned API/MCP/browser handles were closed.',
);
s +=
  '\nCompleted ' +
  new Date().toISOString() +
  '. Uncommitted QA evidence only; no commit created.\n';
await writeFile(dir + '/REPORT.md', s);
console.log('Final report populated with completed suites, isolated outcomes and cleanup.');
