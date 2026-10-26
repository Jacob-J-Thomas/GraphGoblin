// Read the model catalog compiled into the Codex CLI binary (no execution): every embedded
// pretty-printed JSON model entry with its slug, default and supported reasoning levels. (#205 D1)
//
// Usage: node codex-model-catalog.mjs <codex.exe> <log file>
import { readFileSync, writeFileSync } from 'node:fs';

const [binary, log] = process.argv.slice(2);
const text = readFileSync(binary).toString('latin1');
const lines = [];
const seen = new Set();
const pattern = /"slug":\s*"([^"]+)"/g;
for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
  // Each catalog entry is a JSON object; take a bounded window after the slug for its levels.
  const window = text.slice(match.index, match.index + 20_000);
  const end = window.search(/\n\s{4}\},?\n/);
  const entry = end > 0 ? window.slice(0, end) : window.slice(0, 4000);
  const defaultLevel = /"default_reasoning_level":\s*"([^"]+)"/.exec(entry)?.[1] ?? '(none)';
  const levels = [
    ...(/"supported_reasoning_levels":\s*\[([\s\S]*?)\]/.exec(entry)?.[1] ?? '').matchAll(
      /"effort":\s*"([^"]+)"/g,
    ),
  ].map((m) => m[1]);
  const visibility = /"visibility":\s*"([^"]+)"/.exec(entry)?.[1] ?? '(none)';
  const line = `${match[1]}: default=${defaultLevel} supported=[${levels.join(', ')}] visibility=${visibility}`;
  if (!seen.has(line)) {
    seen.add(line);
    lines.push(line);
  }
}
writeFileSync(log, `Embedded Codex CLI model catalog entries (${lines.length})\n${lines.join('\n')}\n`);
