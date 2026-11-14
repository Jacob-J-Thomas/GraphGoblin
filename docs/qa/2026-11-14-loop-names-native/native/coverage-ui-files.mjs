import { readFileSync } from 'node:fs';

const s = JSON.parse(readFileSync(new URL('../coverage-web/coverage-summary.json', import.meta.url), 'utf8'));
const want = /^src\/(lib\/loop-names|components\/loop-name-conflict|editor\/(NameConflictNotice|EditorPage|EditorToolbar|LoopSettingsPanel|save-status|store|useAutosave)|loops\/(LoopsPage|TemplateGallery))\.tsx?$/;
const backslash = String.fromCharCode(92);
const out = [];
for (const key of Object.keys(s)) {
  if (key === 'total') continue;
  const rel = key.split(backslash).join('/').split('/apps/web/')[1];
  if (rel && want.test(rel)) {
    out.push(`${rel.padEnd(48)} lines ${String(s[key].lines.pct).padStart(6)}  branches ${String(s[key].branches.pct).padStart(6)}`);
  }
}
console.log(out.join('\n'));
