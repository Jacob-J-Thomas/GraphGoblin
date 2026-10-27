// A controlled fake Codex CLI (no provider) that reproduces how CLI 0.160.0 reports a turn whose
// request the provider refused (final integrated check F2, LP-5): the JSON event stream carries
// `thread.started`, `turn.started`, then `error` and `turn.failed` with the provider's HTTP 400 body;
// stderr carries only the startup banner; the process exits with code 1, so the SDK then throws
// "Codex Exec exited with code 1: Reading prompt from stdin...". The test sets the SDK's executable
// to this Node binary and preloads this module (NODE_OPTIONS=--import), as for argv-cli.mjs.
// GG_FAKE_CODEX_FAILURE selects what the stream reports:
// - `refused`: the provider's 400 for effort minimal;
// - `invalid-value`, `missing-thread`: a 400 whose provider text also contains a phrase GraphGoblin
//   recognises in CLI messages (PR #426 review B2);
// - `unrecognized`: a failure message GraphGoblin does not classify;
// - `malformed`: a generic diagnostic, then a line that is not JSON and exit 0, so the SDK throws
//   its own parse error instead of an exit error (PR #426 review B1).
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
  const scenario = process.env.GG_FAKE_CODEX_FAILURE;
  const providerText = {
    refused:
      "Unsupported value: 'minimal' is not supported with the 'gpt-6-luna' model. Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.",
    'invalid-value': "Error: invalid value for reasoning.effort: 'minimal'.",
    'missing-thread': 'Thread not found in referenced input.',
  }[scenario];
  const message = providerText
    ? JSON.stringify({
        type: 'error',
        error: {
          message: providerText,
          type: 'invalid_request_error',
          param: 'reasoning.effort',
          code: 'unsupported_value',
        },
        status: 400,
      })
    : scenario === 'malformed'
      ? 'An earlier generic diagnostic'
      : 'The synthetic turn stopped for a reason GraphGoblin does not classify';
  print({ type: 'thread.started', thread_id: 'refused-thread' });
  print({ type: 'turn.started' });
  print({ type: 'error', message });
  if (scenario === 'malformed') {
    writeSync(1, 'MALFORMED_PROTOCOL_ITEM\n');
    process.exit(0);
  }
  print({ type: 'turn.failed', error: { message } });
  process.exit(1);
}
