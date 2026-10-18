import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const worktree = fs.realpathSync('.'),
  reportPath = 'docs/qa/2026-10-16-format-4-integration-qa.md';
const report = fs.readFileSync(reportPath, 'utf8');
const summary = JSON.parse(fs.readFileSync('.tmp/qa/summary.json', 'utf8'));
assert.equal(summary.passed, 165);
assert.equal(summary.failed, 0);
assert.equal(summary.notTestable, 6);
const rows = report.split('\n').filter((x) => /^\| (?:ENV-|L-|G-|W-|EV-|P-|C-|I-|T-|D-)/.test(x));
assert.equal(rows.length, 165);
assert(rows.every((x) => /\| PASS\s+\|/.test(x)));
assert.equal(report.split('\n').filter((x) => /^\| NT-/.test(x)).length, 6);
let links = 0;
for (const match of report.matchAll(/\]\(([^)]+)\)/g)) {
  const [target, anchor] = match[1].split('#');
  assert(!/^[a-z]+:/i.test(target), 'No external file links');
  const absolute = fs.realpathSync(path.resolve(path.dirname(reportPath), target));
  assert(absolute.startsWith(worktree + path.sep), 'Link leaves worktree');
  if (anchor) {
    const linked = fs.readFileSync(absolute, 'utf8');
    const headers = [...linked.matchAll(/^#+ (.+)$/gm)].map((x) =>
      x[1]
        .toLowerCase()
        .replace(/[^\w\- ]/g, '')
        .replace(/ /g, '-'),
    );
    assert(headers.includes(anchor), `Missing anchor ${anchor}`);
  }
  links++;
}
const http = fs.readFileSync('.tmp/qa/http.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
assert.equal(new Set(http.map((x) => x.id)).size, http.length);
for (const h of http) {
  const u = new URL(h.request.url);
  assert.equal(u.origin, 'http://127.0.0.1:4796');
  if (h.request.wireFile) {
    const bytes = fs.readFileSync(path.join('.tmp/qa', h.request.wireFile));
    assert.equal(bytes.length, h.request.bodyBytes);
  }
  if (u.pathname.startsWith('/secrets/') && h.request.method === 'PUT') {
    assert.equal(h.request.body, '[REDACTED throwaway secret]');
    assert(!h.request.wireFile);
  }
  for (let i = 0; i < h.request.headers.length; i += 2)
    if (/signature/i.test(h.request.headers[i]))
      assert(h.request.headers[i + 1].startsWith('[REDACTED'));
}
assert(!report.includes('<!-- HTML'));
console.log(
  JSON.stringify({
    caseRows: rows.length,
    notTestable: 6,
    validLocalLinks: links,
    capturedRequests: http.length,
    requestOrigins: 'QA instance only',
    credentials: 'secret bodies/signatures redacted',
    reportBytes: Buffer.byteLength(report),
  }),
);
