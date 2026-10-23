import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const directory = new URL('./', import.meta.url);
async function read(file) {
  const bytes = await readFile(new URL(file, directory));
  return bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8');
}
const summary = {
  head: '06244e4cdf50d44ca1814136f5735e0d08486fff',
  classification: {},
  installed: [],
  coverage: {},
  triage: {},
};
for (const phase of ['before', 'after', 'after-gates']) {
  const cases = JSON.parse(await read('classification-' + phase + '.json'));
  const results = cases.flatMap((item) => item.actual);
  summary.classification[phase] = {
    cases: cases.length,
    passed: results.filter((item) => item.pass === true).length,
    failed: results.filter((item) => item.pass === false).length,
    recordOnly: results.filter((item) => item.pass === null).length,
    http200: cases.every((item) => item.http === 200),
    sentinelExposed: cases.some((item) => item.sentinelExposed),
  };
}
assert.equal(summary.classification.after.failed, 0);
assert.equal(summary.classification['after-gates'].failed, 0);
for (let attempt = 1; attempt <= 5; attempt++) {
  const log = await read('installed-' + attempt + '.log.txt');
  assert(/Tests\s+1 passed/.test(log));
  summary.installed.push({
    attempt,
    exit: 0,
    passedReadyAssertion: true,
    probeMs: Number(log.match(/actual installed native Claude without a model turn (\d+)ms/)?.[1]),
    log: 'installed-' + attempt + '.log.txt',
  });
}
await writeFile(
  new URL('installed-results.json', directory),
  JSON.stringify(summary.installed, null, 2) + '\n',
);
for (const name of ['infrastructure', 'adapter', 'api', 'api-fixed']) {
  const file = name === 'api-fixed' ? 'api-coverage-fixed.log.txt' : name + '-coverage.log.txt';
  const log = await read(file);
  assert(/Coverage summary/.test(log), file + ' is incomplete');
  summary.coverage[name] = {
    file,
    tests: log.match(/^\s+Tests\s+(.+)$/m)?.[1],
    files: log.match(/^\s+Test Files\s+(.+)$/m)?.[1],
    lines: log.match(/^Lines\s+:\s+(.+)$/m)?.[1],
    branches: log.match(/^Branches\s+:\s+(.+)$/m)?.[1],
    errors: log.match(/^\s+Errors\s+(.+)$/m)?.[1],
  };
}
for (const name of [
  'infra-adversarial',
  'infra-process-scripts',
  'infra-claude-process',
  'infra-claude-readiness',
  'infra-upgrade',
  'adapter-probe-directory',
  'api-classifiers',
]) {
  const file = name + '-alone.log.txt';
  const log = await read(file);
  summary.triage[name] = { file, tests: log.match(/^\s+Tests\s+(.+)$/m)?.[1] };
}
const listeners = (await read('listeners.jsonl'))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
summary.listeners = {
  logged: listeners.length,
  outsideRange: listeners.filter((item) => item.port < 5630 || item.port > 5639).length,
};
assert.equal(summary.listeners.outsideRange, 0);
await writeFile(new URL('summary.json', directory), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
