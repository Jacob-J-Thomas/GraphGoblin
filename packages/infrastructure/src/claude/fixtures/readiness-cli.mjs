import process from 'node:process';
import { setInterval } from 'node:timers';
const print = (text) => process.stdout.write(text + '\n');
// Controlled executable boundary. This fixture never accepts a prompt or starts a model turn.
const [scenario, ...args] = process.argv.slice(2);
if (args.includes('--version')) print(scenario === 'old' ? '2.1.284' : '2.1.287');
else if (args.includes('--help')) {
  const flags =
    '--safe-mode --restricted --setting-sources --strict-mcp-config --tools --allowedTools --permission-mode --permission-prompts --effort --json-schema --output-format --input-format --model --verbose --print --no-session-persistence --resume';
  print(
    scenario === 'missing-model'
      ? flags.replace('--model', '')
      : scenario === 'missing-effort'
        ? flags.replace('--effort', '')
        : flags,
  );
} else if (args.includes('auth')) {
  const profiles = {
    'auth-network': ['', 'API Error: 401 Authentication failed; check network settings.', 1],
    'quota-network': ['', 'HTTP 429 Too Many Requests; network request failed.', 1],
    'stdout-quota-warning': [
      'API Error: 429 Too Many Requests',
      'Warning: setting is deprecated',
      1,
    ],
    'auth-empty': ['', '', 0],
    'auth-unrecognised': ['{}', '', 0],
    'conflict-auth-stderr': [
      'API Error: 429 Too Many Requests',
      'HTTP 401 Authentication failed',
      1,
    ],
    'conflict-quota-stderr': [
      'HTTP 401 Authentication failed',
      'API Error: 429 Too Many Requests',
      1,
    ],
  };
  const failures = {
    quota: 'Usage limit reached: quota exhausted PRIVATE_QUOTA_MARKER',
    transport: 'Network connection failed: ECONNRESET PRIVATE_TRANSPORT_MARKER',
    unknown: 'unrecognized diagnostic PRIVATE_UNKNOWN_MARKER',
  };
  if (profiles[scenario]) {
    const [stdout, stderr, code] = profiles[scenario];
    process.stdout.write(String(stdout));
    process.stderr.write(String(stderr));
    process.exitCode = Number(code);
  } else if (scenario === 'hang') setInterval(() => {}, 1000);
  else if (scenario === 'auth') {
    print('{"loggedIn":false,"authMethod":"none"}');
    process.exitCode = 1;
  } else if (failures[scenario]) {
    process.stderr.write(failures[scenario]);
    process.exitCode = 1;
  } else print('{"authMethod":"claude.ai"}');
} else throw new Error('A no-turn fixture received a turn command');
