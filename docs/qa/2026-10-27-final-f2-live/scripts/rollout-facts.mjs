// node rollout-facts.mjs <out-name> <thread-id> : for ONE Codex thread this QA created, write the
// entry kinds, the turn_context model/effort fields and any error/abort event messages (redacted)
// from the CLI's own session history. Never prints prompts, replies, instructions or metadata.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from './lib.mjs';

const [name, threadId] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/.test(threadId ?? '')) throw new Error('thread id required');
const root = path.join(os.homedir(), '.codex', 'sessions');
let file = null;
const now = new Date();
for (const d of [0, 1]) {
  const t = new Date(now.getTime() - d * 86_400_000);
  const day = path.join(root, String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'));
  if (fs.existsSync(day)) for (const f of fs.readdirSync(day)) if (f.includes(threadId)) file = path.join(day, f);
}
const out = { threadId, file: file ? path.basename(file) : null, entries: [] };
if (file) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      out.entries.push({ kind: 'unparsed' });
      continue;
    }
    const kind = [j.type, j.payload?.type].filter(Boolean).join('/');
    const entry = { kind };
    if (j.type === 'turn_context') Object.assign(entry, { model: j.payload?.model, effort: j.payload?.effort ?? j.payload?.reasoning_effort ?? null });
    if (/error|abort|fail|stream/i.test(kind)) entry.message = String(j.payload?.message ?? j.payload?.reason ?? j.payload?.error ?? '').slice(0, 600);
    // task_complete carries the turn's error, if any (message and error category only).
    if (kind === 'event_msg/task_complete')
      Object.assign(entry, {
        error: j.payload?.error ? { message: String(j.payload.error.message ?? '').slice(0, 600), codexErrorInfo: j.payload.error.codex_error_info ?? null } : null,
        lastAgentMessage: j.payload?.last_agent_message == null ? null : `<${String(j.payload.last_agent_message).length} chars>`,
      });
    out.entries.push(entry);
  }
}
fs.writeFileSync(path.join(L.OUT, `${name}.log.txt`), L.redact(JSON.stringify(out, null, 2)) + '\n');
process.stdout.write(L.redact(JSON.stringify(out, null, 2)) + '\n');
