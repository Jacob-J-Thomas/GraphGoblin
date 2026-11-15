import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const out = path.join(batch, 'review-485-astra-scan2');
const read = p => fs.readFileSync(p);
const json = p => JSON.parse(read(p).toString().replace(/^\uFEFF/, ''));
const hash = p => crypto.createHash('sha256').update(read(p)).digest('hex');
const clean = p => read(p).toString().replace(/\x1b\[[0-9;]*m/g, '');
const current = path.join(batch, 'review-381/current-ci-693e-attempt2');
const original = path.join(batch, 'review-381/current-ci-693e');
const log = clean(path.join(current,'gates.decoded.log'));
const summaries = [...log.matchAll(/##\[group\]@graphgoblin\/([^:\s]+):test:coverage([\s\S]*?)##\[endgroup\]/g)].map(([,pkg,body])=>{
  const tests = /Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?/.exec(body);
  const pct = label => Number(new RegExp(label + '\\s*:\\s*([0-9.]+)%').exec(body)?.[1]);
  return {package:pkg,passed:Number(tests?.[1]),skipped:Number(tests?.[2] ?? 0),lines:pct('Lines'),branches:pct('Branches'),statements:pct('Statements'),functions:pct('Functions')};
});
const archive = json(path.join(out,'coverage-archive-readback.json'));
for(const s of summaries){const a=archive.entries.find(e=>e.path===(s.package==='tooling'?'tooling':(['api','web','mcp','plugin-claude','plugin-codex'].includes(s.package)?'apps/':'packages/')+s.package)+'/coverage/coverage-summary.json');s.archiveMetricsMatch=!!a&&['lines','branches','statements','functions'].every(k=>a[k]===s[k]);}
const originalChecks = read(path.join(original,'SHA256SUMS.txt')).toString().split(/\r?\n/).filter(Boolean).map(line=>{const [,expected,p]=/^([a-f0-9]{64}) [ *](.+)$/.exec(line);return {path:p,matched:hash(path.join(original,p))===expected};});
const jobs=['browser','windows-launcher','template-image'].map(job=>{const p=path.join(original,'job-logs',job+'.decoded.log');const text=clean(p);return {job,sha256:hash(p),checkout:text.split('\n').find(l=>l.includes('HEAD is now at')),relevantLines:text.split('\n').filter(l=>/481 passed|1 skipped|# tests 14|# pass 14|# fail 0|No files were found|\{"template":/.test(l))};});
const result={at:new Date().toISOString(),gatesLogSha256:hash(path.join(current,'gates.decoded.log')),checkout:log.split('\n').find(l=>l.includes('HEAD is now at')),summaries,passed:summaries.reduce((n,s)=>n+s.passed,0),skipped:summaries.reduce((n,s)=>n+s.skipped,0),groups:summaries.length,allArchiveMetricsMatch:summaries.every(s=>s.archiveMetricsMatch),steps:json(path.join(current,'gates.steps.json')),originalManifestEntries:originalChecks.length,originalManifestMismatches:originalChecks.filter(r=>!r.matched),carriedExecutionLogs:jobs,terminalLines:log.split('\n').filter(l=>/12 successful, 12 total|22 successful, 22 total|0 cached, 12 total|9 cached, 22 total|Licence allowlist:|Generated docs are up to date|0 failing enforced|21 vulnerabilities|Severity:|SHA256 digest of uploaded/.test(l)),qualification:'The three separate jobs carried forward from attempt 1. Gates executed anew, including its tooling browser measurements.'};
fs.writeFileSync(path.join(out,'ci-readback.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,skipped:result.skipped,groups:result.groups,allArchiveMetricsMatch:result.allArchiveMetricsMatch,steps:result.steps.steps.length,allStepsSuccess:result.steps.steps.every(s=>s.conclusion==='success'),originalManifestEntries:result.originalManifestEntries,originalManifestMismatches:result.originalManifestMismatches,carriedExecutionLogs:result.carriedExecutionLogs,terminalLines:result.terminalLines},null,2));
