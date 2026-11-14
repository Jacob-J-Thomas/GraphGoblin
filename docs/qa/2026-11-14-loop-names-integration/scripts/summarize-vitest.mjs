import { readFileSync, writeFileSync } from 'node:fs';

// Usage: node summarize-vitest.mjs <vitest-json> [files-out]
const [input, filesOut] = process.argv.slice(2);
const report = JSON.parse(readFileSync(input, 'utf8'));
const slash = String.fromCharCode(92);
const files = report.testResults
  .map((t) => t.name.split(slash).join('/').replace(/^.*\/apps\/web\//, ''))
  .sort();
if (filesOut) writeFileSync(filesOut, files.join('\n') + '\n');
console.log(
  JSON.stringify({
    success: report.success,
    files: files.length,
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    pending: report.numPendingTests,
    todo: report.numTodoTests,
    failedSuites: report.numFailedTestSuites,
  }),
);
