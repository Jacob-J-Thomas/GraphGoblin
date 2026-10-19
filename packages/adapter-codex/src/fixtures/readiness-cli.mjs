import process from 'node:process';
import { setInterval } from 'node:timers';
const print = (text) => process.stdout.write(text + '\n');
// Controlled no-turn CLI; receiving any turn command is a fixture failure.
const [scenario, ...args] = process.argv.slice(2);
if (args.includes('--version'))
  print(scenario === 'old' ? 'codex-cli 0.100.0' : 'codex-cli 0.160.0');
else if (args.includes('--help'))
  print(
    scenario === 'missing-model'
      ? '--json'
      : '--json --model --sandbox --cd --skip-git-repo-check --output-schema --config',
  );
else if (args.join(' ') === 'login status') {
  const failures = {
    auth: 'Not logged in',
    quota: 'quota exhausted',
    transport: 'ECONNRESET network',
    unknown: 'unrecognized diagnostic',
  };
  if (scenario === 'hang') setInterval(() => {}, 1000);
  else if (failures[scenario]) {
    process.stderr.write(failures[scenario] + ' PRIVATE_MARKER');
    process.exitCode = 1;
  } else print('Logged in using ChatGPT');
} else throw new Error('Unexpected turn command');
