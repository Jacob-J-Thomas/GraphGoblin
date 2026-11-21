// D203 QA fixture standing in for the Claude CLI. Harmless and local: no network, provider or
// model. argv: <mode> ...claude-args. Modes: success (default), slow (turn result after 1,500 ms),
// signed-out (auth status reports completed sign-out on stderr with exit 1).
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const [mode = 'success', ...args] = process.argv.slice(2);
const line = (value) => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
const FLAGS = [
  '--safe-mode', '--restricted', '--setting-sources', '--strict-mcp-config', '--tools',
  '--allowedTools', '--permission-mode', '--permission-prompts', '--effort', '--json-schema',
  '--output-format', '--input-format', '--model', '--verbose', '--print',
  '--no-session-persistence', '--resume',
];
const SESSION = '22222222-2222-4222-8222-222222222222';
if (args.includes('--version')) line('2.1.290 (Claude Code)');
else if (args.includes('--help')) line(`Usage: claude [options]\n${FLAGS.join('\n')}`);
else if (args.includes('auth')) {
  if (mode === 'signed-out') {
    process.stderr.write('Not logged in\n');
    process.exitCode = 1;
  } else line({ loggedIn: true, authMethod: 'claude.ai' });
} else if (args.includes('--print')) {
  for await (const chunk of process.stdin) void chunk;
  if (mode === 'slow') await delay(1500);
  line({
    type: 'system',
    subtype: 'init',
    session_id: SESSION,
    tools: ['Read', 'Glob', 'Grep'],
    permissionMode: 'dontAsk',
    model: 'claude-opus-5-5',
    apiKeySource: 'none',
    mcp_servers: [],
    plugins: [],
    skills: [],
  });
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: SESSION,
    result: 'QA_D203_TURN_OK',
    usage: { input_tokens: 2, output_tokens: 3 },
    modelUsage: { 'claude-opus-5-5': {} },
  });
} else {
  process.stderr.write('qa fixture: unexpected command\n');
  process.exitCode = 2;
}
