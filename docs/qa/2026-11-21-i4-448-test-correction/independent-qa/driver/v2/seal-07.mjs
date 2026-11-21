// QA448 run 07: seal every file written by this QA (excludes runner/root-owned BRIEF.md, spec.json, provider/).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
const Q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-448-test-independent-01';
if (existsSync(join(Q, 'seal.json'))) throw new Error('seal exists');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const excluded = (p) => p === 'BRIEF.md' || p === 'spec.json' || p === 'seal.json' || p.startsWith('provider/');
const members = walk(Q).map((f) => relative(Q, f).split(sep).join('/')).filter((p) => !excluded(p)).sort().map((p) => ({ path: p, bytes: statSync(join(Q, p)).size, sha256: createHash('sha256').update(readFileSync(join(Q, p))).digest('hex') }));
const git = (...a) => execFileSync('git', ['-C', 'G:/ggq/gg-i4-448-qa/GraphGoblin', ...a], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const seal = {
  schema: 'qa448-independent-seal-sha256/1',
  qa: '#448 D194 independent corrective QA (Claude Opus 5.5/xhigh)',
  verdict: 'PASS (C1 isolation, C2 storage contract, C3 old-predicate control, C4 scope/preservation); owner #448 closure, hosted CI, native and root completion remain',
  candidate: { commit: '446da9ce32b2304f17c53b5ff09af559f35dd3cf', tree: '53af267660277933a2dd57718b528b7849cea2fb', parent: 'cc0a52cffe7e0bffb197c3f3342d370e2b1b9794', file: 'apps/api/src/preflight-catalog.test.ts', fileSha256: 'a67356cd6773b265df80ced4e26a9c1f17cd0fe0c48f2d4cb286ddc315c611ae' },
  checkoutAtSeal: { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain=v1', '-uall'), priorBranch: git('rev-parse', 'refs/heads/codex/gg-i4-448-qa') },
  excluded: ['BRIEF.md', 'spec.json', 'provider/**', 'seal.json'],
  sealedAtUtc: new Date().toISOString(),
  reportSha256: members.find((m) => m.path === 'report.md').sha256,
  members,
};
writeFileSync(join(Q, 'seal.json'), JSON.stringify(seal, null, 2), { flag: 'wx' });
// Re-verify.
const re = JSON.parse(readFileSync(join(Q, 'seal.json'), 'utf8'));
const bad = re.members.filter((m) => createHash('sha256').update(readFileSync(join(Q, m.path))).digest('hex') !== m.sha256);
console.log(JSON.stringify({ members: re.members.length, bytes: re.members.reduce((n, m) => n + m.bytes, 0), mismatched: bad.length, reportSha256: re.reportSha256, checkoutAtSeal: re.checkoutAtSeal, sealSha256: createHash('sha256').update(readFileSync(join(Q, 'seal.json'))).digest('hex') }, null, 2));
