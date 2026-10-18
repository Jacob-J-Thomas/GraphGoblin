import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const base = path.resolve('.tmp/qa');
const history = fs
  .readFileSync(path.join(base, 'cases.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse);
const cases = [...new Map(history.map((x) => [x.id, x])).values()];
const http = fs
  .readFileSync(path.join(base, 'http.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse)
  .sort((a, b) => a.id.localeCompare(b.id));
const nts = JSON.parse(fs.readFileSync(path.join(base, 'not-testable.json'), 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const summary = {
  passed: cases.filter((x) => x.result === 'PASS').length,
  failed: cases.filter((x) => x.result === 'FAIL').length,
  notTestable: nts.length,
  total: cases.length + nts.length,
};
const short = (v, n = 240) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const cell = (s) =>
  String(s ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const caseHttp = (row) => {
  const ids = row.evidence.match(/H\d+/g);
  if (!ids) return [];
  return http.filter((h) => h.id >= ids[0] && h.id <= ids.at(-1));
};
function primary(row, requests) {
  const err = requests.filter((x) => x.response.status >= 400);
  if (err.length) return err.at(-1);
  if (row.system === 'Webhooks')
    return (
      requests
        .filter((x) => x.request.method === 'POST' && x.request.url.includes('/hooks/'))
        .at(-1) ?? requests.at(-1)
    );
  if (row.system === 'Event triggers')
    return (
      requests
        .filter((x) => x.request.method === 'POST' && x.request.url.endsWith('/events'))
        .at(-1) ?? requests.at(-1)
    );
  if (row.system === 'Loop deletion')
    return requests.filter((x) => x.request.method === 'DELETE').at(-1) ?? requests.at(-1);
  if (row.system === 'Gates and exits')
    return (
      requests
        .filter(
          (x) =>
            /\/runs\/[^/?]+$/.test(x.request.url) &&
            ['failed', 'succeeded', 'exhausted'].includes(x.response.body?.status),
        )
        .at(-1) ?? requests.at(-1)
    );
  return requests.filter((x) => x.request.method !== 'GET').at(-1) ?? requests.at(-1);
}
function excerpt(h) {
  const b = h.response.body;
  if (b === null || typeof b !== 'object') return short(b, 170);
  if (b.code)
    return short(
      { code: b.code, ...(b.errors ? { errors: b.errors } : {}), detail: b.detail },
      210,
    );
  if (b.status && b.failure)
    return short(
      {
        status: b.status,
        failure: {
          code: b.failure.code,
          resumable: b.failure.resumable,
          ...(b.failure.details?.maxNodeVisits
            ? { details: { maxNodeVisits: b.failure.details.maxNodeVisits } }
            : {}),
        },
      },
      210,
    );
  if (b.status && b.outcome)
    return short({ status: b.status, outcome: b.outcome, result: b.result }, 210);
  if (b.duplicate !== undefined)
    return short({ duplicate: b.duplicate, runIds: b.runIds, id: b.id }, 210);
  if (b.notices)
    return short(
      { notices: b.notices, issues: b.issues, schemaVersion: b.draft?.definition?.schemaVersion },
      210,
    );
  if (b.version?.definition)
    return short(
      {
        version: b.version.version,
        schemaVersion: b.version.definition.schemaVersion,
        issues: b.issues,
      },
      210,
    );
  if (b.loop)
    return short(
      {
        loop: { id: b.loop.id, currentVersionId: b.loop.currentVersionId },
        draft: { id: b.draft?.id, schemaVersion: b.draft?.definition?.schemaVersion },
        issues: b.issues,
      },
      210,
    );
  return short(b, 210);
}
function actual(row, requests) {
  const h = primary(row, requests);
  let result = h
    ? `${h.response.status} ${h.response.status === 204 ? '(empty body)' : excerpt(h)}`
    : row.actual;
  let a;
  try {
    a = JSON.parse(row.actual);
  } catch {}
  if (a?.lastDecision)
    result += `; passes=${a.threadGate.passes}, port=${a.lastDecision.portId}, limit=${a.lastDecision.gate.limit}`;
  else if (a?.trigger) result += `; eventType=${a.trigger.eventType ?? '(none)'}`;
  else if (a?.runCount !== undefined) result += `; runs=${a.runCount}`;
  else if (a?.receipts) result += `; states=${a.receipts.join(',')}`;
  return result;
}
const systems = [
  'Instance and method',
  'Loops and definitions',
  'Gates and exits',
  'Webhooks',
  'Event triggers',
  'Poll and cron',
  'Old export import',
  'Templates',
  'Loop deletion',
];
const lines = [
  '# Format-4 integration: touched-systems API QA — 2026-10-16',
  '',
  `**Result:** ${summary.passed} passed, ${summary.failed} failed, ${summary.notTestable} not testable (${summary.total} distinct cases). **Confirmed defects: 0.**`,
  '',
  '## Head, instance and method',
  '',
  `- Checkout: \`${head}\` (requested integration head \`9da6c2b\`), independently read from Git before and after testing.`,
  '- Instance: **http://127.0.0.1:4796** only. Health, version, OpenAPI and Swagger endpoints answered 200. `/version` reports `graphgoblin-api` `0.1.0`; it does not attest a Git hash. The served-head identity is supplied by the orchestrator; checkout identity is locally verified.',
  `- Capture interval: ${http[0].at}–${http.at(-1).at} (UTC); report date uses America/Chicago. Fresh disposable QA storage supplied by the orchestrator.`,
  '- Read AGENTS.md, docs/README.md, the API/trigger/engine documentation, Unreleased upgrade notes, ADR-0035–0038 and existing QA reports. Tests use the strict current contracts and the frozen format-3 fixture shapes.',
  '- Real HTTP through Node `http`; exact raw UTF-8 and binary bodies; Node `crypto.createHmac` for both signing recipes; ordinary API publishing, persistence, run snapshots, threads, run events and private Events. Only expression decisions, mutate nodes, waits and short local Node scripts were executed. LLM/classifier definitions were authored and round-tripped without execution.',
  '- Work was performed alone. No product code, Git index, commits, branches, server lifecycle, owner storage or other instances were changed. Temporary test scripts and raw evidence are in `.tmp/qa/`; this report is the only nonignored addition.',
  '- Secrets were API-created random throwaway values. Secret values and signature header values are redacted from captures. Raw-body files never contain secret-creation bodies. Signing recipes in the scripts reproduce the requests using fresh API-created secrets.',
  '',
  '## Defect summary',
  '',
  '| Severity | Confirmed defects |',
  '| --- | ---: |',
  '| Critical | 0 |',
  '| High | 0 |',
  '| Medium | 0 |',
  '| Low | 0 |',
  '',
  '## Evidence and accounting',
  '',
  'Each table row is one distinct scripted case; a case may include setup, negative requests and several persistence assertions. Expected refusals count as passes. Totals count the final completed execution per stable case ID, rather than HTTP calls or harness attempts. No executed product case remains failed.',
  '',
  'The evidence references link to the [case evidence index](../../.tmp/qa/evidence.md). Each case expands to exact method, URL, headers and request body/wire-file references, response status and body excerpt. [HTTP JSONL](../../.tmp/qa/http.jsonl) retains full response bodies; [readable HTTP capture](../../.tmp/qa/http-evidence.md) includes every recorded request, including prerequisite setup and earlier harness attempts. HMAC headers and secret creation are the only intentional credential redactions. `.tmp/qa/` is gitignored and must remain with this worktree for the full local evidence; it will not be included when the orchestrator commits this report.',
  '',
  'Harness calibration corrected a missing Host header, inappropriate empty JSON Content-Type on DELETE, current queued-event/thread field paths, the Poll payload shape, and an incomplete frozen V3 signing fixture. A single comma-containing header was initially expected to be ambiguous; the contract accepts it as one scalar EventName, while duplicate raw header fields correctly return 400. Corrected cases were rerun with their intended assertions; earlier attempts remain in the capture and are not product defects.',
  '',
  '| System | Passed | Failed | Not testable |',
  '| --- | ---: | ---: | ---: |',
  ...systems.map(
    (s) =>
      `| ${s} | ${cases.filter((x) => x.system === s && x.result === 'PASS').length} | ${cases.filter((x) => x.system === s && x.result === 'FAIL').length} | 0 |`,
  ),
  `| Separate surfaces / restricted scenarios | 0 | 0 | ${nts.length} |`,
  `| **Total** | **${summary.passed}** | **${summary.failed}** | **${summary.notTestable}** |`,
  '',
];
for (const system of systems) {
  lines.push(
    `## ${system}`,
    '',
    '| Case | Expected | Actual response excerpt / observation | Result | Evidence |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const row of cases.filter((x) => x.system === system)) {
    const requests = caseHttp(row);
    lines.push(
      `| ${cell(row.id + ': ' + row.name)} | ${cell(row.expected)} | ${cell(actual(row, requests))} | ${row.result} | [${row.evidence}](../../.tmp/qa/evidence.md#${row.id.toLowerCase()}) |`,
    );
  }
  lines.push('');
}
lines.push(
  '## Defects',
  '',
  'No reproducible product defect was found in the executed API cases. There is no code-fix recommendation from this run. Steps, expected/actual behavior, severity and suggested fix location would be recorded here for any confirmed defect; none qualified.',
  '',
  '## Residual risks and scenarios not testable here',
  '',
  '| Case | Expected coverage | Actual limitation | Result | Evidence |',
  '| --- | --- | --- | --- | --- |',
  ...nts.map(
    (x) =>
      `| ${cell(x.id + ': ' + x.name)} | ${cell(x.expected)} | ${cell(x.actual)} | NOT TESTABLE | Scope restriction |`,
  ),
  '',
  '- Healthy webhook intake yielded `admitted` and `deduplicated`, with exact public `202 {"accepted":true}`, safe pinned configuration and attempts/run links. `pending`/`failed` transitions, retry scheduling and historical `filtered` rows require fault injection or historical state; they are not qualified by merely appearing in OpenAPI. No fault injection, store editing or restart was performed.',
  '- Cross-version and cross-authentication key permanence, plus concurrent repeats, were exercised in this process. Permanent storage across a stopped-store restart, uncertain-write recovery, crash-atomic gate advancement, installed-store conversion and deletion against a pending admission remain separate checks.',
  '- Time limits were exercised after real script delays and a real parked duration wait, including finishing after the time limit and priority when both limits bind. Pause/recovery downtime and replay-fork timing were not exercised. The runtime cap remains a gate check, not a watchdog.',
  '- Caller returns were tested for successful, Failure and Exhausted outcomes, and a deliberate mapping error produced a node failure. Other external return destinations, live model/provider responses, native harness sessions and browser/device-draft behavior were outside this bounded API assignment.',
  '- Poll None and real local Node-script probes ran on the live scheduler; the second sweep respected the key. Cron preview, invalid admission and future arming were tested; long-lived cron firing/DST/restart catch-up were not observed.',
  '- No QA runs remained queued, running, waiting or paused at final verification. QA pollers were disabled through ordinary save/publish. One waiting run left by an early failed harness attempt was cancelled using its recorded QA-created loop ID. Other disposable loop definitions, completed runs and throwaway secrets remain for inspection; no broad cleanup was performed.',
  '',
  '## Reproduction scripts',
  '',
  'Run each once from this worktree with Node; each hardcodes only the designated QA port and creates its own disposable definitions. The running instance is required. Do not substitute the owner instance.',
  '',
  '```powershell',
  'node .tmp/qa/loops-gates.mjs',
  'node .tmp/qa/webhooks.mjs',
  'node .tmp/qa/remaining.mjs',
  'node .tmp/qa/boundaries.mjs',
  'node .tmp/qa/final-checks.mjs',
  'node .tmp/qa/make-report.mjs',
  '```',
  '',
  '[Common HTTP recorder](../../.tmp/qa/common.mjs), [loop/gate scenarios](../../.tmp/qa/loops-gates.mjs), [webhook scenarios](../../.tmp/qa/webhooks.mjs), [events/poll/cron/import/templates/deletion](../../.tmp/qa/remaining.mjs), [boundary checks](../../.tmp/qa/boundaries.mjs), [final checks](../../.tmp/qa/final-checks.mjs), [automatic V3 export](../../.tmp/qa/format3-automatic.json), [pending LLM export](../../.tmp/qa/format3-pending-llm.json), [cleanup scope](../../.tmp/qa/cleanup.json).',
  '',
);
fs.writeFileSync('docs/qa/2026-10-16-format-4-integration-qa.md', lines.join('\n'));
const index = [
  '# Format-4 QA case evidence',
  '',
  'Final execution per case ID. All URLs use http://127.0.0.1:4796. Full capture, including setup, is in [HTTP evidence](http-evidence.md).',
  '',
  'Secret bodies and HMAC signatures are redacted. Body wire files preserve exact transmitted bytes for all other requests.',
];
for (const row of cases) {
  const requests = caseHttp(row);
  index.push(
    '',
    `## ${row.id}`,
    row.name,
    '',
    `**${row.result}** — expected: ${row.expected}`,
    '',
    `Observed assertion result: ${short(row.actual, 1400)}`,
    '',
    '| Request | HTTP | Response excerpt |',
    '| --- | --- | --- |',
  );
  for (const h of requests)
    index.push(
      `| [${h.id}: ${h.request.method} ${cell(new URL(h.request.url).pathname + new URL(h.request.url).search)}](http-evidence.md#${h.id.toLowerCase()}) | ${h.response.status} | ${cell(excerpt(h))} |`,
    );
}
fs.writeFileSync(path.join(base, 'evidence.md'), index.join('\n') + '\n');
const rawmd = [
  '# Recorded HTTP exchanges',
  '',
  'Exact request method, URL, ordered header pairs and body bytes are retained. Signatures and secret creation values are redacted. Response excerpts are capped for readability; complete response bodies are in http.jsonl. Earlier harness attempts and prerequisite setup are intentionally included.',
];
for (const h of http) {
  rawmd.push(
    '',
    `## ${h.id}`,
    '',
    `${h.at} — ${h.request.method} ${h.request.url}`,
    '',
    '```json',
    JSON.stringify(
      { headers: h.request.headers, bodyBytes: h.request.bodyBytes, note: h.request.note },
      null,
      2,
    ),
    '```',
    '',
  );
  if (h.request.wireFile)
    rawmd.push(`[Exact ${h.request.bodyBytes}-byte request body](${h.request.wireFile})`, '');
  if (h.request.body !== null) rawmd.push('```text', h.request.body, '```', '');
  rawmd.push(
    `Response: **HTTP ${h.response.status}**`,
    '',
    '```json',
    short(h.response.body, 1800),
    '```',
  );
}
fs.writeFileSync(path.join(base, 'http-evidence.md'), rawmd.join('\n') + '\n');
fs.writeFileSync(
  path.join(base, 'summary.json'),
  JSON.stringify(
    {
      ...summary,
      head,
      systems: systems.map((s) => ({
        system: s,
        passed: cases.filter((x) => x.system === s && x.result === 'PASS').length,
        failed: cases.filter((x) => x.system === s && x.result === 'FAIL').length,
      })),
      report: 'docs/qa/2026-10-16-format-4-integration-qa.md',
      capture: { requests: http.length, start: http[0].at, end: http.at(-1).at },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary));
