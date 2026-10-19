import process from 'node:process';
import { setInterval } from 'node:timers';
const print = (text) => process.stdout.write(text + '\n');
// Controlled executable boundary. This fixture never accepts a prompt or starts a model turn.
const [scenario, ...args] = process.argv.slice(2);
if (args.includes('--version')) print(scenario === 'old' ? '2.1.284' : '2.1.287');
else if (args.includes('--help')) {
  const flags =
    '--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume';
  print(scenario === 'missing-model' ? flags.replace('--model', '') : flags);
} else if (args.includes('auth')) {
  const failures = {
    auth: 'Authentication failed: not logged in PRIVATE_AUTH_MARKER',
    quota: 'Usage limit reached: quota exhausted PRIVATE_QUOTA_MARKER',
    transport: 'Network connection failed: ECONNRESET PRIVATE_TRANSPORT_MARKER',
    unknown: 'unrecognized diagnostic PRIVATE_UNKNOWN_MARKER',
  };
  if (scenario === 'hang') setInterval(() => {}, 1000);
  else if (failures[scenario]) {
    process.stderr.write(failures[scenario]);
    process.exitCode = 1;
  } else print('{"authMethod":"claude.ai"}');
} else throw new Error('A no-turn fixture received a turn command');
