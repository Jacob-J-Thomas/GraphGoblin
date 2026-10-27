// A controlled fake Codex CLI (no provider) for API tests through the real CodexHarness and SDK. It
// reports a turn whose request the provider refused the way Codex CLI 0.160.0 does (final integrated
// check F2, LP-5; recorded shape in packages/adapter-codex/fixtures/failed-invalid-model.jsonl):
// `error` and `turn.failed` carry the provider's HTTP 400 body, stderr only the startup banner, and
// the process exits with code 1. The test sets the SDK's executable to this Node binary and preloads
// this module with NODE_OPTIONS=--import, so it runs before Node looks for a script named `exec`.
import { readFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';

if (basename(process.argv[1] ?? '') === 'exec' && process.argv.includes('--experimental-json')) {
  writeSync(2, 'Reading prompt from stdin...\n');
  try {
    readFileSync(0);
  } catch {
    // The prompt is not needed; a closed or empty stdin is fine.
  }
  const print = (event) => writeSync(1, JSON.stringify(event) + '\n');
  const message = JSON.stringify({
    type: 'error',
    status: 400,
    error: {
      type: 'invalid_request_error',
      message: "The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.",
    },
  });
  print({ type: 'thread.started', thread_id: 'refused-thread' });
  print({ type: 'turn.started' });
  print({ type: 'error', message });
  print({ type: 'turn.failed', error: { message } });
  process.exit(1);
}
