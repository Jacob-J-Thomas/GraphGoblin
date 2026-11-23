
import { openSync, closeSync, existsSync, renameSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
async function controlledWrite(file, contents) {
  const descriptor = openSync(file, 'w');
  try {
    const witness = file + '.old-pause';
    writeFileSync(witness + '.pending', JSON.stringify({ pid: process.pid, parentPid: process.ppid }), { flag: 'wx' });
    renameSync(witness + '.pending', witness);
    const deadline = Date.now() + 5000;
    while (!existsSync(file + '.old-release') && Date.now() < deadline) await delay(10);
    writeFileSync(descriptor, contents);
  } finally { closeSync(descriptor); }
}
// Harmless CLI stand-in for the installed SDK's output-schema lifecycle. No provider is run.
import { readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import process from 'node:process';
import { setInterval } from 'node:timers';

if (basename(process.argv[1] ?? '') === 'exec' && process.argv.includes('--experimental-json')) {
  const args = process.argv.slice(2);
  const schemaPath = args[args.indexOf('--output-schema') + 1];
  const schemaText = readFileSync(schemaPath, 'utf8');
  await controlledWrite(
    process.env.GG_SCHEMA_RECORD,
    JSON.stringify({
      pid: process.pid,
      schemaPath,
      schemaDirectory: dirname(schemaPath),
      schemaText,
      schema: JSON.parse(schemaText),
      argv: args,
    }),
  );
  readFileSync(0);
  const event = (value) => writeSync(1, JSON.stringify(value) + '\n');
  event({ type: 'thread.started', thread_id: 'schema-fixture' });
  event({ type: 'turn.started' });
  if (process.env.GG_SCHEMA_MODE === 'error') {
    writeSync(2, 'Controlled schema fixture failure\n');
    process.exit(7);
  }
  if (process.env.GG_SCHEMA_MODE === 'abort') {
    await new Promise(() => {
      setInterval(() => undefined, 1000);
    });
  }
  event({
    type: 'item.completed',
    item: { id: 'answer', type: 'agent_message', text: '{"ok":true}' },
  });
  event({
    type: 'turn.completed',
    usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
  });
  process.exit(0);
}
