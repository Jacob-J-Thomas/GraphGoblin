// Harmless Codex CLI stand-in for the independent #442 UI/browser QA (authored for this phase).
// It answers only the four no-turn readiness commands the built Codex adapter runs, records every
// invocation, and rejects anything else (plugin/MCP inventory, exec turns, app-server...) with
// exit 97 so an unexpected command is visible instead of silently succeeding. It never contacts a
// provider, reads no credentials and writes only to the QA-owned call log.
import { appendFileSync, readFileSync } from 'node:fs';

const statePath = process.env.GG442UI_STATE;
const callsPath = process.env.GG442UI_CALLS;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
const command = args.join(' ');
const started = Date.now();
const record = (extra) =>
  appendFileSync(
    callsPath,
    JSON.stringify({
      pid: process.pid,
      ppid: process.ppid,
      args,
      cwd: process.cwd(),
      mode: state.mode,
      delayMs: state.delayMs ?? 0,
      at: new Date().toISOString(),
      ...extra,
    }) + '\n',
  );
record({ event: 'start' });

const ALLOWED = ['--version', 'exec --help', 'exec resume --help', 'login status'];
const HELP_FLAGS = ['--json', '--model', '--sandbox', '--cd', '--skip-git-repo-check', '--output-schema'];

let code = 0;
let stdout = '';
let stderr = '';
if (!ALLOWED.includes(command)) {
  stderr = 'QA fixture rejected unexpected command\n';
  code = 97;
} else {
  if (command === '--version' && state.delayMs)
    await new Promise((resolve) => setTimeout(resolve, state.delayMs));
  switch (command) {
    case '--version':
      if (state.mode === 'unknown') {
        stderr = 'QA fixture: unrecognized diagnostic from the stand-in\n';
        code = 1;
      } else stdout = 'codex-cli 0.160.0\n';
      break;
    case 'exec --help':
      // The incompatible mode omits one required option the adapter checks for.
      stdout =
        'Usage: codex exec [OPTIONS]\n' +
        [...HELP_FLAGS, ...(state.mode === 'incompatible' ? [] : ['--config'])].join('\n') +
        '\n';
      break;
    case 'exec resume --help':
      stdout = 'Usage: codex exec resume [OPTIONS]\n--json\n';
      break;
    case 'login status':
      if (state.mode === 'auth') {
        stderr = 'Not logged in\n';
        code = 1;
      } else if (state.mode === 'quota') {
        stderr = 'QA fixture: HTTP 429 Too Many Requests\n';
        code = 1;
      } else if (state.mode === 'transport') {
        stderr = 'QA fixture: stream disconnected before completion\n';
        code = 1;
      } else stdout = 'Logged in using a disposable QA fixture\n';
      break;
  }
}
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
record({ event: 'end', exitCode: code, elapsedMs: Date.now() - started });
process.exitCode = code;
