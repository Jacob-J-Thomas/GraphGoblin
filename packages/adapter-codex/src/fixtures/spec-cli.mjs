// A controlled fake Codex CLI (no provider) driven by an explicit spec, after the fixture of the
// PR #426 audit scan 3: GG_FAKE_CODEX_SPEC is JSON `{events, stderr, exit}`. The CLI prints each
// event as a JSON line on stdout, writes `stderr` as given and exits with `exit` (default 1), so
// the real SDK meets any ordering of stream events and any stderr payload. The test sets the SDK's
// executable to this Node binary and preloads this module (NODE_OPTIONS=--import).
import { readFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';

if (basename(process.argv[1] ?? '') === 'exec' && process.argv.includes('--experimental-json')) {
  try {
    readFileSync(0);
  } catch {
    // The prompt is not needed; a closed or empty stdin is fine.
  }
  const spec = JSON.parse(process.env.GG_FAKE_CODEX_SPEC ?? '{}');
  for (const event of spec.events ?? []) writeSync(1, JSON.stringify(event) + '\n');
  if (spec.stderr) writeSync(2, spec.stderr);
  process.exit(spec.exit ?? 1);
}
