// A controlled fake Codex CLI (no provider) for argument assertions through the real SDK. The SDK
// spawns `<codexPathOverride> exec --experimental-json ...`; the test sets that path to this Node
// executable and preloads this module with NODE_OPTIONS=--import, so the process records the exact
// arguments the CLI would receive, completes one turn and exits before Node runs a script named
// `exec`. Any other Node process that inherits the preload is left alone.
//
// Before each turn the harness lists the machine's MCP servers with `<binary> mcp list --json`
// (ADR-0063). This fake answers it as CLI 0.160.0 does, with one entry per server named in
// GG_FAKE_CODEX_MCP (a JSON array of names, default none), after a warning on stderr;
// GG_FAKE_CODEX_LISTING records that call's arguments and working directory;
// GG_FAKE_CODEX_MCP_EXIT makes it fail with that code.
import { readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
import process from 'node:process';

const command = basename(process.argv[1] ?? '');

if (command === 'mcp' && process.argv.includes('list')) {
  if (process.env.GG_FAKE_CODEX_LISTING)
    writeFileSync(
      process.env.GG_FAKE_CODEX_LISTING,
      JSON.stringify({ argv: ['mcp', ...process.argv.slice(2)], cwd: process.cwd() }),
    );
  // The real CLI can warn on stderr (for example about PATH aliases under a temporary
  // CODEX_HOME); only stdout carries the JSON.
  writeSync(2, 'WARNING: proceeding, even though we could not create PATH aliases\n');
  const exit = Number(process.env.GG_FAKE_CODEX_MCP_EXIT ?? 0);
  if (exit) {
    writeSync(2, 'Error: failed to load configuration\n');
    process.exit(exit);
  }
  const names = JSON.parse(process.env.GG_FAKE_CODEX_MCP ?? '[]');
  writeSync(
    1,
    JSON.stringify(
      names.map((name) => ({
        name,
        enabled: true,
        transport: { type: 'stdio', command: 'fake', args: [] },
      })),
    ) + '\n',
  );
  process.exit(0);
}

if (command === 'exec' && process.argv.includes('--experimental-json')) {
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
