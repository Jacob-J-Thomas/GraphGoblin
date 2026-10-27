// A controlled fake Codex CLI (no provider) that reproduces how CLI 0.160.0 reports a turn whose
// request the provider refuses (final integrated check F2, LP-5): the JSON event stream carries
// `thread.started`, `turn.started`, then `error` and `turn.failed` with the provider's HTTP 400 body;
// stderr carries only the startup banner; the process exits with code 1, so the SDK then throws
// "Codex Exec exited with code 1: Reading prompt from stdin...". The test sets the SDK's executable
// to this Node binary and preloads this module (NODE_OPTIONS=--import), as for argv-cli.mjs.
// GG_FAKE_CODEX_FAILURE selects what the stream reports: `refused` (the provider's 400) or
// `unrecognized` (a failure message GraphGoblin does not classify).
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
  const message =
    process.env.GG_FAKE_CODEX_FAILURE === 'unrecognized'
      ? 'The synthetic turn stopped for a reason GraphGoblin does not classify'
      : JSON.stringify({
          type: 'error',
          error: {
            message:
              "Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model. Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.",
            type: 'invalid_request_error',
            param: 'reasoning.effort',
            code: 'unsupported_value',
          },
          status: 400,
        });
  print({ type: 'thread.started', thread_id: 'refused-thread' });
  print({ type: 'turn.started' });
  print({ type: 'error', message });
  print({ type: 'turn.failed', error: { message } });
  process.exit(1);
}
