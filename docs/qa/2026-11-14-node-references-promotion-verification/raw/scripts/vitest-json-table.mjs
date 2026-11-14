// Usage: node vitest-json-table.mjs <vitest-json> <output-tsv>
import { readFileSync, writeFileSync } from 'node:fs';
const [input, output] = process.argv.slice(2);
const report = JSON.parse(readFileSync(input, 'utf8'));
const slash = String.fromCharCode(92);
const rows = report.testResults.map((file) => ({
  file: file.name.split(slash).join('/').replace(/^.*\/(apps|packages)\//, '$1/'),
  passed: file.assertionResults.filter((a) => a.status === 'passed').length,
  failed: file.assertionResults.filter((a) => a.status === 'failed').length,
  other: file.assertionResults.filter((a) => a.status !== 'passed' && a.status !== 'failed').length,
  status: file.status,
})).sort((a, b) => (a.file < b.file ? -1 : 1));
const text = ['file\tpassed\tfailed\tother\tstatus', ...rows.map((r) => [r.file, r.passed, r.failed, r.other, r.status].join('\t'))].join('\n') + '\n';
writeFileSync(output, text);
console.log(text);
console.log('files', report.testResults.length, 'total', report.numTotalTests, 'passed', report.numPassedTests, 'failed', report.numFailedTests, 'pending', report.numPendingTests, 'todo', report.numTodoTests, 'success', report.success);
