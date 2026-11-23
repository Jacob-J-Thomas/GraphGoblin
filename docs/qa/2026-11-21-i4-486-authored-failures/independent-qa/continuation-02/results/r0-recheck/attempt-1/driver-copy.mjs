// R0: cheap identity/hash re-check before new scenarios (no rebuild, no scenario).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, recorder, sha256 } from './lib/rec.mjs';

const Q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents';
const r = recorder('r0');
const git = (...a) => execFileSync('git', ['-C', CHECKOUT, ...a], { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const parent = git('rev-parse', 'HEAD^');
const porcelain = git('status', '--porcelain', '--untracked-files=all');
r.check('R0-id', 'HEAD/tree/parent equal frozen candidate', head === '633d9ac72c10fe4b8d76f7ba50221f9ed8557cb9' && tree === 'd0e38c6c0212e312e6b605ac3d6bc8f7af5a129f' && parent === '02351e2fb932b3be44e7cc3fb3943a61d568226c', { head, tree, parent }, 'STATIC-IDENTITY');
r.check('R0-clean', 'porcelain (incl. untracked) empty', porcelain === '', { porcelain }, 'STATIC-IDENTITY');

const freeze = JSON.parse(readFileSync(join(Q, 'i4-486-source-freeze-01/receipt.json'), 'utf8'));
const mism = [];
for (const f of freeze.files) {
  const bytes = readFileSync(join(CHECKOUT, f.path));
  if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) mism.push(f.path);
}
r.check('R0-src', `all ${freeze.files.length} frozen source files equal (bytes+sha256)`, freeze.files.length === 52 && mism.length === 0, { count: freeze.files.length, mismatches: mism }, 'STATIC-IDENTITY');

const manifestPath = join(Q, 'i4-486-independent-01/results/00-bind/attempt-1/dist-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = Object.entries(manifest);
const diff = [];
for (const [p, h] of entries) {
  let actual;
  try { actual = sha256(readFileSync(join(CHECKOUT, p))); } catch { actual = 'missing'; }
  if (actual !== h) diff.push({ p, h, actual });
}
const aggregate = sha256(entries.map(([p, h]) => `${p} ${h}`).join('\n'));
r.check('R0-dist', `all ${entries.length} original-manifest dist files unchanged`, entries.length === 1189 && diff.length === 0, { count: entries.length, diff: diff.slice(0, 20), manifestSha: sha256(readFileSync(manifestPath)), joinedEntriesSha: aggregate }, 'STATIC-IDENTITY');
r.finish({ head, tree });
