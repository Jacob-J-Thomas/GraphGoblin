import process from 'node:process';
import { setInterval } from 'node:timers';
const print = (text) => process.stdout.write(text + '\n');
// Controlled no-turn CLI; receiving any turn command is a fixture failure.
const [scenario, ...args] = process.argv.slice(2);
if (args.includes('--version'))
  print(
    scenario === 'old'
      ? 'codex-cli 0.100.0'
      : scenario === 'prerelease'
        ? 'codex-cli 0.161.0-alpha'
        : 'codex-cli 0.160.0',
  );
else if (args.includes('--help')) {
  const flags = '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config';
  print(
    scenario === 'missing-model'
      ? flags.replace('--model', '')
      : scenario === 'missing-effort'
        ? flags.replace('--config', '')
        : scenario === 'missing-resume-json' && args.includes('resume')
          ? flags.replace('--json', '')
          : flags,
  );
} else if (args.join(' ') === 'login status') {
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
  };
  const failures = {
    auth: 'Not logged in',
    quota: 'quota exhausted',
    transport: 'ECONNRESET network',
    unknown: 'unrecognized diagnostic',
  };
  if (profiles[scenario]) {
    const [stdout, stderr, code] = profiles[scenario];
    process.stdout.write(String(stdout));
    process.stderr.write(String(stderr));
    process.exitCode = Number(code);
  } else if (scenario === 'hang') setInterval(() => {}, 1000);
  else if (failures[scenario]) {
    process.stderr.write(failures[scenario] + ' PRIVATE_MARKER');
    process.exitCode = 1;
  } else print('Logged in using ChatGPT');
} else throw new Error('Unexpected turn command');
