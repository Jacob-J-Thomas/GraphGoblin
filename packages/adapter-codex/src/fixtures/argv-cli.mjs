// A controlled fake Codex CLI (no provider) for argument assertions through the real SDK. The SDK
// spawns `<codexPathOverride> exec --experimental-json ...`; the test sets that path to this Node
// executable and preloads this module with NODE_OPTIONS=--import, so the process records the exact
// arguments the CLI would receive, completes one turn and exits before Node runs a script named
// `exec`. Any other Node process that inherits the preload is left alone.
import { readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';

if (basename(process.argv[1] ?? '') === 'exec' && process.argv.includes('--experimental-json')) {
  try {
    readFileSync(0);
  } catch {
    // The prompt is not needed; a closed or empty stdin is fine.
  }
  writeFileSync(process.env.GG_FAKE_CODEX_ARGV, JSON.stringify(process.argv.slice(2)));
  const print = (event) => writeSync(1, JSON.stringify(event) + '\n');
  print({ type: 'thread.started', thread_id: 'argv-thread' });
  print({ type: 'turn.started' });
  print({
    type: 'item.completed',
    item: { id: 'answer', type: 'agent_message', text: 'Recorded' },
  });
  print({
    type: 'turn.completed',
    usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
  });
  process.exit(0);
}
