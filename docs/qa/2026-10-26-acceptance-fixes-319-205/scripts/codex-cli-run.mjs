// Run the Codex CLI the product pins with no credentials and no network: an empty, disposable
// CODEX_HOME, no OPENAI_API_KEY or CODEX_API_KEY, and every HTTP(S) proxy pointed at the closed
// local port 9, so no request can leave the machine. Prints the exit code and output.
//
// Usage: node codex-cli-run.mjs <codex.exe> [args...]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [binary, ...args] = process.argv.slice(2);
const home = mkdtempSync(join(tmpdir(), 'gg-af-codex-home-'));
const cwd = mkdtempSync(join(tmpdir(), 'gg-af-codex-cwd-'));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_HOME'].includes(key.toUpperCase()),
  ),
);
Object.assign(env, {
  CODEX_HOME: home,
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: '',
});
const result = spawnSync(binary, args, {
  cwd,
  env,
  input: '',
  timeout: 60_000,
  windowsHide: true,
  encoding: 'utf8',
});
process.stdout.write(
  `$ codex ${args.join(' ')}\nexit: ${result.status}${result.signal ? ` signal ${result.signal}` : ''}${result.error ? ` error ${result.error.message}` : ''}\n` +
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}\n`,
);
rmSync(home, { recursive: true, force: true });
rmSync(cwd, { recursive: true, force: true });
