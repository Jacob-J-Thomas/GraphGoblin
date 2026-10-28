// Remove the Codex CLI's session records left by this record's turns: rollouts under
// %USERPROFILE%\.codex\sessions\2026\10\{27,28} whose first-line cwd lies in a %TEMP%\gg-423-*
// store. Lists (and with --delete removes) only those; no other session is read past its first
// line or touched.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { firstLine, redact } from './lib.mjs';

const remove = process.argv.includes('--delete');
const prefix = path.join(os.tmpdir(), 'gg-423-').toLowerCase();
const root = path.join(os.homedir(), '.codex', 'sessions');
const hits = [];
for (const day of ['27', '28']) {
  const dir = path.join(root, '2026', '10', day);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(dir, name);
    let cwd = '';
    try {
      cwd = String(JSON.parse(firstLine(full))?.payload?.cwd ?? '');
    } catch {
      continue;
    }
    if (cwd.toLowerCase().startsWith(prefix)) {
      hits.push({ file: path.relative(root, full), cwd: redact(cwd) });
      if (remove) fs.rmSync(full);
    }
  }
}
console.log(JSON.stringify({ removed: remove, count: hits.length, hits }, null, 1));
