// Which sections the model-visible session context holds (`codex debug prompt-input`, no model
// call) under the turn's isolation defaults, with and without `multi_agent`/`goals` switched off.
// Prints each item's role, length and XML-like section tags; never the text itself.
//   node prompt-sections.mjs <codex.exe>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const codex = process.argv[2];
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-423-prompt-'));
const base = ['features.plugins=false', 'features.apps=false', 'features.memories=false', 'features.hooks=false', 'notify=[]'];
const sections = (overrides) => {
  const r = spawnSync(codex, ['debug', 'prompt-input', ...overrides.flatMap((o) => ['-c', o]), 'Reply OK.'], {
    encoding: 'utf8',
    windowsHide: true,
    cwd,
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0) return { exit: r.status };
  return JSON.parse(r.stdout).map((item) => {
    const body = JSON.stringify(item.content ?? '');
    return `${item.role ?? item.type}(${body.length}): ${[...new Set([...body.matchAll(/<([a-z_]{3,40})>/g)].map((m) => m[1]))].join(',')}`;
  });
};
console.log(JSON.stringify({ previousDefaults: sections(base), withMultiAgentAndGoalsOff: sections([...base, 'features.multi_agent=false', 'features.goals=false']) }, null, 1));
fs.rmSync(cwd, { recursive: true, force: true });
