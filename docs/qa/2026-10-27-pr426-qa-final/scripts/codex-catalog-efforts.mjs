// Derive the Codex efforts GraphGoblin offers from the model catalog compiled into the pinned
// Codex CLI binary, without running it (no process start, no provider call). For each model the
// product seeds, print the CLI's default and supported reasoning levels and their intersection with
// GraphGoblin's canonical effort scale; also count any `minimal` or `none` level anywhere in the
// binary's catalog. Adapted from docs/qa/2026-10-26-acceptance-fixes-319-205/scripts/codex-model-catalog.mjs.
//
// Usage: node codex-catalog-efforts.mjs <codex.exe> <log file>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [binary, log] = process.argv.slice(2);
const bytes = readFileSync(binary);
const text = bytes.toString('latin1');
const canonical = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const seeded = [
  'gpt-6-luna',
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-6-astra',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.5',
];
const lines = [
  `binary: ${binary.replaceAll('\\', '/').replace(/^.*node_modules/, 'node_modules')}`,
  `bytes: ${bytes.length}`,
  `sha256: ${createHash('sha256').update(bytes).digest('hex')}`,
  '',
];

/** Every embedded entry for a slug: a bounded window from the slug to the end of its object. */
function entries(slug) {
  const found = [];
  const marker = `"slug": "${slug}"`;
  for (let index = text.indexOf(marker); index >= 0; index = text.indexOf(marker, index + 1)) {
    const window = text.slice(index, index + 20_000);
    const end = window.search(/\n\s{4}\},?\n/);
    const entry = end > 0 ? window.slice(0, end) : window.slice(0, 4000);
    const levels = [
      ...(/"supported_reasoning_levels":\s*\[([\s\S]*?)\]/.exec(entry)?.[1] ?? '').matchAll(
        /"effort":\s*"([^"]+)"/g,
      ),
    ].map((match) => match[1]);
    const fallback = /"default_reasoning_level":\s*"([^"]+)"/.exec(entry)?.[1] ?? '(none)';
    found.push(`default=${fallback} supported=[${levels.join(', ')}]`);
  }
  return [...new Set(found)];
}

lines.push('model | CLI catalog (distinct embedded entries) | GraphGoblin offers (canonical scale ∩ CLI levels)');
for (const slug of seeded) {
  const found = entries(slug);
  const levels = new Set(found.flatMap((line) => /supported=\[(.*)\]/.exec(line)[1].split(', ')));
  const offered = canonical.filter((effort) => levels.has(effort));
  lines.push(`${slug} | ${found.join(' ; ') || '(not found)'} | ${offered.join(', ')}`);
}
lines.push('');
for (const level of ['minimal', 'none']) {
  const count = [...text.matchAll(new RegExp(`"effort":\\s*"${level}"`, 'g'))].length;
  lines.push(`occurrences of a catalog level "${level}": ${count}`);
}
writeFileSync(log, lines.join('\n') + '\n', 'utf8');
