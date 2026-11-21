import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { setInterval } from 'node:timers';
const command = path.basename(process.argv[1] ?? '');
const args = process.argv.slice(2);
const write = (target, data) => fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
if (command === 'mcp' && args.includes('list')) {
  write(process.env.QA363_LIST, { pid: process.pid, command, args, cwd: process.cwd(), entries: fs.readdirSync(process.cwd()) });
  fs.writeSync(1, '[]\n'); process.exit(0);
}
if (command === 'exec' && args.includes('--experimental-json')) {
  const schemaPath = args[args.indexOf('--output-schema') + 1];
  const cwd = args[args.indexOf('--cd') + 1];
  const bytes = fs.readFileSync(schemaPath);
  try { fs.readFileSync(0); } catch {}
  write(process.env.QA363_TURN, { pid: process.pid, command, args, cwd, cwdLength: cwd.length, cwdEntries: fs.readdirSync(cwd), schemaPath, schemaDir: path.dirname(schemaPath), schemaDirLength: path.dirname(schemaPath).length, schemaFileLength: schemaPath.length, schema: JSON.parse(bytes), schemaText: bytes.toString(), schemaSha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  if (process.env.QA363_MODE === 'error') { fs.writeSync(2, 'QA363 controlled harmless CLI failure\n'); process.exit(7); }
  if (process.env.QA363_MODE === 'abort') { setInterval(() => {}, 1000); }
  else {
    const emit = (event) => fs.writeSync(1, JSON.stringify(event) + '\n');
    emit({ type: 'thread.started', thread_id: 'qa363-independent' }); emit({ type: 'turn.started' });
    emit({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '{"proof":"sdk363","ok":true}' } });
    emit({ type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 3 } });
    process.exit(0);
  }
} else { fs.writeSync(2, 'Unexpected harmless CLI arguments\n'); process.exit(97); }
