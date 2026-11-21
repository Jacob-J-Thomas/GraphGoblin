// QA448 run 06: read-only post-checks. Writes observations/06-postchecks.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const Q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-448-test-independent-01';
const ROOT = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents';
const QA = 'G:/ggq/gg-i4-448-qa/GraphGoblin';
const AUTHOR = 'G:/ggq/gg-i4-448-preflight/GraphGoblin';
const SCRATCH = 'G:/ggq/qa-scratch/i4-448-test-independent-01';
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const out = { utc: new Date().toISOString(), selfPid: process.pid, parentPid: process.ppid };

out.qaCheckout = {
  head: git(QA, 'rev-parse', 'HEAD'),
  detached: (() => { try { git(QA, 'symbolic-ref', '-q', 'HEAD'); return false; } catch { return true; } })(),
  tree: git(QA, 'rev-parse', 'HEAD^{tree}'),
  parent: git(QA, 'rev-parse', 'HEAD^'),
  status: git(QA, 'status', '--porcelain=v1', '-uall'),
  stagedDiffEmpty: (() => { try { git(QA, 'diff', '--cached', '--quiet'); return true; } catch { return false; } })(),
  worktreeDiffEmpty: (() => { try { git(QA, 'diff', '--quiet'); return true; } catch { return false; } })(),
  candidateFileSha256: sha(join(QA, 'apps/api/src/preflight-catalog.test.ts')),
  priorBranch: git(QA, 'rev-parse', 'refs/heads/codex/gg-i4-448-qa'),
};
out.authorCheckout = { head: git(AUTHOR, 'rev-parse', 'HEAD'), status: git(AUTHOR, 'status', '--porcelain=v1', '-uall'), fileSha256: sha(join(AUTHOR, 'apps/api/src/preflight-catalog.test.ts')) };

// Original sealed evidence: re-verify each member against its own seal (read-only).
const verifySeal = (dir, sealFile, listKey) => {
  const seal = JSON.parse(readFileSync(join(dir, sealFile), 'utf8'));
  const members = seal[listKey];
  const bad = members.filter((m) => !existsSync(join(dir, m.path)) || sha(join(dir, m.path)) !== m.sha256 || statSync(join(dir, m.path)).size !== m.bytes).map((m) => m.path);
  return { seal: `${relative(ROOT, dir)}/${sealFile}`, sealSha256: sha(join(dir, sealFile)), members: members.length, mismatched: bad };
};
out.sealedEvidence = [
  verifySeal(join(ROOT, 'i4-448-test-author-01'), 'evidence-seal.json', 'entries'),
  verifySeal(join(ROOT, 'i4-551-final-astra-01'), 'hashes.json', 'members'),
];
out.referenceFiles = Object.fromEntries(
  ['decision-194.md', 'd194-catalog-entry.json', 'i4-448-test-root-freeze-01/receipt.json', 'i4-448-test-root-freeze-01/source.patch', 'i4-551-final-astra-01/report.md', 'i4-448-test-author-01/report.md', 'i4-448-test-independent-01/BRIEF.md', 'i4-448-test-independent-01/spec.json'].map((p) => [p, sha(join(ROOT, p))]),
);
out.briefSpecUnchanged = out.referenceFiles['i4-448-test-independent-01/BRIEF.md'] === '05344da2f018eadc2a603c306b84802a4405c6a5247a4ee55de995d15160d1a5' && out.referenceFiles['i4-448-test-independent-01/spec.json'] === '787bde5ac31715cc7d48be8fedecb0e8394f4a841af94b8c62157a577633d915';

// Owned processes: every PID that installed my guard or was tracked by my pollers, and any process whose
// command line references my output folder, guard, scratch or QA checkout.
const pids = new Set();
for (const f of readdirSync(join(Q, 'commands'))) {
  if (f.endsWith('.guard.jsonl')) for (const l of readFileSync(join(Q, 'commands', f), 'utf8').split('\n').filter(Boolean)) { const e = JSON.parse(l); if (e.event === 'installed') pids.add(e.pid); }
  if (f.endsWith('.tcp.jsonl')) for (const l of readFileSync(join(Q, 'commands', f), 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)) { const e = JSON.parse(l.replace(/^\uFEFF/, '')); if (e.event === 'process-tracked') pids.add(e.pid); if (e.event === 'poller-start') { pids.add(e.pollerPid); pids.add(e.rootPid); } }
}
const procs = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const alive = new Map(procs.map((p) => [p.ProcessId, p]));
out.recordedPids = [...pids].sort((a, b) => a - b).map((pid) => {
  const p = alive.get(pid);
  return { pid, alive: Boolean(p), name: p?.Name, commandLine: p ? String(p.CommandLine ?? '').slice(0, 200) : undefined };
});
const markers = ['i4-448-test-independent-01', 'guard.cjs', 'qa448', 'gg-i4-448-qa'];
out.processesReferencingMarkers = procs
  .filter((p) => p.ProcessId !== process.pid && markers.some((m) => String(p.CommandLine ?? '').toLowerCase().includes(m.toLowerCase())))
  .map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, commandLine: String(p.CommandLine ?? '').slice(0, 300) }));
out.forbiddenPortListeners = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 4747,4748,11434 } | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress"], { encoding: 'utf8' }).trim() || '[]';

// Retained SQLite blobs: every file name must equal its SHA-256.
const blobDirs = readdirSync(join(Q, 'fixtures')).filter((d) => d.startsWith('blobs-'));
out.blobs = blobDirs.map((d) => {
  const files = readdirSync(join(Q, 'fixtures', d));
  const bad = files.filter((f) => !f.endsWith('.bin') || sha(join(Q, 'fixtures', d, f)) !== f.slice(0, -4));
  return { dir: `fixtures/${d}`, files: files.length, bytes: files.reduce((n, f) => n + statSync(join(Q, 'fixtures', d, f)).size, 0), nameHashMismatches: bad };
});

// Owned scratch inventory (before cleanup), and preservation of run-04 child outputs.
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
out.scratch = readdirSync(SCRATCH).map((name) => {
  const full = join(SCRATCH, name);
  const isDir = statSync(full).isDirectory();
  return { name, isDir, owned: name !== 'claude', files: isDir && name !== 'claude' ? walk(full).map((f) => ({ path: relative(SCRATCH, f), bytes: statSync(f).size, sha256: sha(f) })) : undefined };
});
const run04 = out.scratch.find((s) => s.name.startsWith('qa448-04-') && s.isDir);
if (run04) {
  const dest = join(Q, 'observations', '04-preflight-children');
  mkdirSync(dest, { recursive: true });
  for (const f of run04.files.filter((x) => /^preflight-.*\.json$/.test(x.path.split(/[\\/]/).pop()))) copyFileSync(join(SCRATCH, f.path), join(dest, f.path.split(/[\\/]/).pop()));
  out.preservedPreflightChildOutputs = readdirSync(dest);
}
writeFileSync(join(Q, 'observations', '06-postchecks.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ qaCheckout: out.qaCheckout, authorCheckout: out.authorCheckout, sealedEvidence: out.sealedEvidence, briefSpecUnchanged: out.briefSpecUnchanged, recordedPidsAlive: out.recordedPids.filter((p) => p.alive), processesReferencingMarkers: out.processesReferencingMarkers, forbiddenPortListeners: out.forbiddenPortListeners, blobs: out.blobs, scratch: out.scratch.map((s) => ({ name: s.name, owned: s.owned, files: s.files?.length })), preserved: out.preservedPreflightChildOutputs }, null, 2));
