// Harmless CLI stand-in for the installed SDK's output-schema lifecycle. No provider is run.
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname } from 'node:path';
import process from 'node:process';
import { setInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

if (basename(process.argv[1] ?? '') === 'exec' && process.argv.includes('--experimental-json')) {
  const args = process.argv.slice(2);
  const schemaPath = args[args.indexOf('--output-schema') + 1];
  const schemaText = readFileSync(schemaPath, 'utf8');
  const recordFile = process.env.GG_SCHEMA_RECORD;
  const pendingFile = `${recordFile}.${process.pid}.${randomUUID()}.pending`;
  let pendingOwned = false;
  try {
    const descriptor = openSync(pendingFile, 'wx', 0o600);
    pendingOwned = true;
    try {
      writeFileSync(
        descriptor,
        JSON.stringify({
          pid: process.pid,
          schemaPath,
          schemaDirectory: dirname(schemaPath),
          schemaText,
          schema: JSON.parse(schemaText),
          argv: args,
        }),
      );
    } finally {
      closeSync(descriptor);
    }
    // Test-only barrier: the sibling is complete and closed, but the final marker is absent.
    if (process.env.GG_SCHEMA_PAUSE_FILE) {
      const pausePendingFile = `${pendingFile}.pause`;
      const pauseDescriptor = openSync(pausePendingFile, 'wx', 0o600);
      try {
        try {
          writeFileSync(pauseDescriptor, JSON.stringify({ pendingFile }));
        } finally {
          closeSync(pauseDescriptor);
        }
        renameSync(pausePendingFile, process.env.GG_SCHEMA_PAUSE_FILE);
      } finally {
        rmSync(pausePendingFile, { force: true });
      }
      const deadline = Date.now() + 3000;
      while (!existsSync(process.env.GG_SCHEMA_RELEASE_FILE) && Date.now() < deadline)
        await delay(10);
      if (!existsSync(process.env.GG_SCHEMA_RELEASE_FILE))
        throw new Error('Publication was not released');
    }
    renameSync(pendingFile, recordFile);
    pendingOwned = false;
  } finally {
    if (pendingOwned) rmSync(pendingFile, { force: true });
  }
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
