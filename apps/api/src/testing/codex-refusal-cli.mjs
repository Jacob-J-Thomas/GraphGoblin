// A controlled fake Codex CLI (no provider) for API tests through the real CodexHarness and SDK. It
// reports a turn whose request the provider refused the way Codex CLI 0.160.0 does (final integrated
// check F2, LP-5; recorded shape in packages/adapter-codex/fixtures/failed-invalid-model.jsonl):
// `error` and `turn.failed` carry the provider's HTTP 400 body, stderr only the startup banner, and
// the process exits with code 1. The test sets the SDK's executable to this Node binary and preloads
// this module with NODE_OPTIONS=--import, so it runs before Node looks for a script named `exec`.
// GG_FAKE_PROVIDER_TEXT replaces the provider's message (and then names `reasoning.effort` as the
// refused parameter); GG_FAKE_CODEX_STDERR=repeat writes that same refusal to stderr instead of the
// banner, as the PR #426 audit scan 2 reproduction did.
import { readFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';

// The MCP listing before each turn (ADR-0063): no servers configured.
if (basename(process.argv[1] ?? '') === 'mcp' && process.argv.includes('list')) {
  writeSync(1, '[]\n');
  process.exit(0);
}

if (basename(process.argv[1] ?? '') === 'exec' && process.argv.includes('--experimental-json')) {
  const repeat = process.env.GG_FAKE_CODEX_STDERR === 'repeat';
  if (!repeat) writeSync(2, 'Reading prompt from stdin...\n');
  try {
    readFileSync(0);
  } catch {
    // The prompt is not needed; a closed or empty stdin is fine.
  }
  const print = (event) => writeSync(1, JSON.stringify(event) + '\n');
  const text = process.env.GG_FAKE_PROVIDER_TEXT;
  const message = JSON.stringify({
    type: 'error',
    status: 400,
    error: {
      type: 'invalid_request_error',
      ...(text ? { param: 'reasoning.effort' } : {}),
      message:
        text ?? "The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.",
    },
  });
  print({ type: 'thread.started', thread_id: 'refused-thread' });
  print({ type: 'turn.started' });
  print({ type: 'error', message });
  print({ type: 'turn.failed', error: { message } });
  if (repeat) writeSync(2, message + '\n');
  process.exit(1);
}
