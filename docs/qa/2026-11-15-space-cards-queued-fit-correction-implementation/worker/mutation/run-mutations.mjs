// Sensitivity checks: apply one temporary mutation at a time to the corrected Canvas.tsx, run the two
// Space cards test files, keep each full log and outcome, and always restore the file (hash verified).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'C:/Users/98jak/.codex/worktrees/gg-20261114-space-cards/GraphGoblin';
const target = join(repo, 'apps/web/src/editor/Canvas.tsx');
const out = process.env.MUT_OUT ?? 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-208-queued-fit-implementation/mutation';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const original = readFileSync(target, 'utf8');
const originalHash = sha(original);
mkdirSync(out, { recursive: true });

const mutations = [
  ['M1-no-revision-check', 'live.generation !== pending.generation ||\n      live.revision !== pending.revision', 'live.generation !== pending.generation'],
  ['M2-no-live-checks-at-all', '      live.definition !== pending.definition ||\n      live.generation !== pending.generation ||\n      live.revision !== pending.revision\n', '      false\n'],
  ['M3-no-live-definition-or-generation', '      live.definition !== pending.definition ||\n      live.generation !== pending.generation ||\n', ''],
  ['M4-no-rendered-check', '      pending.definition !== definition ||\n      pending.generation !== generation ||\n', ''],
  ['M5-no-viewport-initialized-check', '!viewportInitialized || !bounds', '!bounds'],
  ['M6-no-pane-check', '|| !paneMeasured(pane)) return;', ') return;'],
  ['M7-no-pane-ready-dependency', 'measured, viewportInitialized, paneReady, setViewport, flowStore]', 'measured, viewportInitialized, setViewport, flowStore]'],
  ['M8-plain-size-lookup', 'Object.hasOwn(measured, node.id) ? measured[node.id] : undefined', 'measured[node.id]'],
  ['M9-any-size-counts', 'if (!size || !isLength(size.width) || !isLength(size.height)) return undefined;', 'if (!size) return undefined;'],
  ['M10-fit-never-spent', '    spacedFitRef.current = undefined;\n    void setViewport(', '    void setViewport('],
];

const results = [];
try {
  for (const [name, find, replace] of mutations) {
    const first = original.indexOf(find);
    if (first < 0 || original.indexOf(find, first + 1) >= 0) {
      results.push({ name, status: 'MUTATION NOT APPLIED (find string absent or not unique)' });
      continue;
    }
    writeFileSync(target, original.replace(find, replace));
    const run = spawnSync(
      'pnpm.cmd',
      ['--filter', '@graphgoblin/web', 'exec', 'vitest', 'run', 'src/editor/Canvas.space-cards.test.tsx', 'src/editor/Canvas.space-cards.fit.test.tsx'],
      { cwd: repo, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const log = `${run.stdout ?? ''}\n--- stderr ---\n${run.stderr ?? ''}`;
    writeFileSync(join(out, `${name}.log`), log);
    const failed = [...log.matchAll(/^\s+× (.+?)(?: \d+ms)?$/gm)].map((m) => m[1]);
    const summary = log.match(/Tests\s+.*$/m)?.[0] ?? '(no summary)';
    results.push({ name, exit: run.status, summary, failed });
    writeFileSync(target, original);
  }
} finally {
  writeFileSync(target, original);
}
const restored = sha(readFileSync(target, 'utf8'));
writeFileSync(join(out, 'results.json'), JSON.stringify({ originalHash, restoredHash: restored, restoredOk: restored === originalHash, results }, null, 2));
console.log(JSON.stringify({ originalHash, restoredHash: restored, restoredOk: restored === originalHash }, null, 2));
for (const r of results) console.log(r.name, r.exit ?? '', r.summary ?? r.status, `failed=${r.failed?.length ?? '-'}`);
