// Independent QA #448 fake Codex CLI probe launcher (GG_CODEX_BINARY ending in .mjs runs through
// the gateway's Node). Private synthetic fixture: no network, no provider, no credentials. Answers
// only the readiness probes and refuses every other invocation (a model turn or MCP listing) with
// exit 86. Every invocation is appended to invocations.jsonl beside this file.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
let kind;
let code = 0;
if (args.includes('--version')) {
  kind = 'version';
  process.stdout.write('codex-cli 0.160.0\n');
} else if (args[0] === 'exec' && args[1] === 'resume' && args.includes('--help')) {
  kind = 'exec-resume-help';
  process.stdout.write('Usage: codex exec resume [OPTIONS]\n  --json --last --model --config\n');
} else if (args[0] === 'exec' && args.includes('--help')) {
  kind = 'exec-help';
  process.stdout.write(
    'Usage: codex exec [OPTIONS]\n  --json --model --sandbox --cd --skip-git-repo-check --output-schema --config\n',
  );
} else if (args[0] === 'login' && args[1] === 'status') {
  kind = 'login-status';
  process.stdout.write('Logged in using ChatGPT\n');
} else {
  kind = 'refused-non-probe';
  process.stderr.write('qa448 fake codex refuses non-probe invocations\n');
  code = 86;
}
appendFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'invocations.jsonl'),
  JSON.stringify({
    cli: 'codex',
    kind,
    exit: code,
    pid: process.pid,
    utc: new Date().toISOString(),
    cwd: process.cwd(),
    args,
  }) + '\n',
);
process.exitCode = code;
