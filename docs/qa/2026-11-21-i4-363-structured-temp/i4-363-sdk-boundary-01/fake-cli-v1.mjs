// Harmless CLI stand-in, following isolation.test.ts. No Codex executable/provider is run.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const command = path.basename(process.argv[1] ?? '');
const args = process.argv.slice(2);
const record = (target, value) => fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
if (command === 'mcp' && args.includes('list')) {
  record(process.env.GG_SDK_LISTING, { command, argv: ['mcp', ...args], cwd: process.cwd(), cwdLength: process.cwd().length, entries: fs.readdirSync(process.cwd()), version: process.version, temp: process.env.TEMP, codexHome: process.env.CODEX_HOME });
  fs.writeSync(1, '[]\n');
  process.exit(0);
}
if (command === 'exec' && args.includes('--experimental-json')) {
  const schemaPath = args[args.indexOf('--output-schema') + 1];
  const requestedCwd = args[args.indexOf('--cd') + 1];
  let input = Buffer.alloc(0);
  try { input = fs.readFileSync(0); } catch {}
  const schemaBytes = fs.readFileSync(schemaPath);
  record(process.env.GG_SDK_TURN, {
    command, argv: ['exec', ...args], processCwd: process.cwd(), requestedCwd, requestedCwdLength: requestedCwd.length,
    requestedCwdEntries: fs.readdirSync(requestedCwd), schemaPath, schemaPathLength: schemaPath.length,
    schemaDir: path.dirname(schemaPath), schemaDirLength: path.dirname(schemaPath).length,
    schemaText: schemaBytes.toString('utf8'), schema: JSON.parse(schemaBytes), schemaSha256: crypto.createHash('sha256').update(schemaBytes).digest('hex'),
    promptBytes: input.length, promptSha256: crypto.createHash('sha256').update(input).digest('hex'), version: process.version,
  });
  const event = (value) => fs.writeSync(1, JSON.stringify(value) + '\n');
  event({ type: 'thread.started', thread_id: 'independent-sdk-boundary' });
  event({ type: 'turn.started' });
  event({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '{"fixture":"sdk-boundary","ok":true}' } });
  event({ type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 3 } });
  process.exit(0);
}
fs.writeSync(2, `Unexpected harmless-CLI command: ${JSON.stringify(process.argv)}\n`);
process.exit(97);
