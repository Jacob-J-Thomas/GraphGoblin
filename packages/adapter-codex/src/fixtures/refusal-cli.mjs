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
// GG_FAKE_CODEX_STDERR selects stderr (PR #426 audit scan 2): `banner` (the default), `repeat` (the
// failure the stream reports, alone) or `banner-repeat` (the banner, then that failure).
// GG_FAKE_CODEX_STREAM=none leaves `error` and `turn.failed` out, so only stderr has the failure.
import { readFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';

// The MCP listing before each turn (ADR-0063): no servers configured.
if (basename(process.argv[1] ?? '') === 'mcp' && process.argv.includes('list')) {
  writeSync(1, '[]\n');
  process.exit(0);
}

if (basename(process.argv[1] ?? '') === 'exec' && process.argv.includes('--experimental-json')) {
  const stderr = process.env.GG_FAKE_CODEX_STDERR ?? 'banner';
  if (stderr !== 'repeat') writeSync(2, 'Reading prompt from stdin...\n');
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
  const reported = process.env.GG_FAKE_CODEX_STREAM !== 'none';
  print({ type: 'thread.started', thread_id: 'refused-thread' });
  print({ type: 'turn.started' });
  if (reported) print({ type: 'error', message });
  if (scenario === 'malformed') {
    writeSync(1, 'MALFORMED_PROTOCOL_ITEM\n');
    process.exit(0);
  }
  if (reported) print({ type: 'turn.failed', error: { message } });
  if (stderr !== 'banner') writeSync(2, message + '\n');
  process.exit(1);
}
