import { appendFileSync, readFileSync } from 'node:fs';

const state = JSON.parse(readFileSync(process.env.GG442_QA_STATE, 'utf8'));
const args = process.argv.slice(2);
const key = args.join(' ');
appendFileSync(process.env.GG442_QA_CALLS, JSON.stringify({
  pid: process.pid, parentPid: process.ppid, args, cwd: process.cwd(),
  mode: state.mode, timestamp: new Date().toISOString(),
  codeHome: process.env.CODEX_HOME, home: process.env.HOME,
}) + '\n');
const allowed = ['--version', 'exec --help', 'exec resume --help', 'login status'];
if (!allowed.includes(key)) {
  process.stderr.write('QA fixture rejected unexpected command');
  process.exitCode = 91;
} else if (key === '--version') {
  if (state.mode === 'unknown') { process.stderr.write('unrecognized diagnostic'); process.exitCode = 1; }
  else process.stdout.write('codex-cli 0.160.0\n');
} else if (key === 'exec --help') {
  process.stdout.write('--json --model --sandbox --cd --skip-git-repo-check --output-schema' +
    (state.mode === 'incompatible' ? '' : ' --config') + '\n');
} else if (key === 'exec resume --help') process.stdout.write('--json\n');
else if (state.mode === 'auth') { process.stderr.write('Not logged in\n'); process.exitCode = 1; }
else process.stdout.write('Logged in using a disposable QA fixture\n');
