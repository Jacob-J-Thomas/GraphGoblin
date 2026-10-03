#!/usr/bin/env node
/* global process, console */
/**
 * Record a real Codex JSONL event stream as a test fixture.
 *
 *   pnpm --filter @graphgoblin/adapter-codex record -- <name> "<prompt>" [options]
 *
 * Options:
 *   --schema <file>      pass `--output-schema <file>` (structured output)
 *   --sandbox <mode>     read-only (default) | workspace-write; workspace-write is only ever used in
 *                        a fresh temporary directory
 *   --model <id>         default gpt-6-luna (the owner's development model)
 *   --effort <level>     default low
 *   --seed <file=text>   write a file into the temporary working directory first (repeatable)
 *
 * Runs `codex exec --json --ephemeral` with the CLI bundled with @openai/codex-sdk (override with
 * CODEX_BIN), in a fresh temporary working directory, and writes `fixtures/<name>.jsonl`. Home and
 * temporary-directory paths are replaced with `<HOME>` and `<TMP>` so fixtures carry no machine
 * details. The process exit code is recorded in a trailing `{"type":"x-recorder.exit"}` line that
 * the tests use to reproduce CLI failures; the SDK never emits that type.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '..', 'fixtures');

function parseArgs(argv) {
  const args = argv.filter((a) => a !== '--');
  const [name, prompt, ...rest] = args;
  if (!name || !prompt) {
    console.error('usage: record.mjs <name> "<prompt>" [--schema f] [--sandbox m] [--model id]');
    process.exit(2);
  }
  const options = { sandbox: 'read-only', model: 'gpt-6-luna', effort: 'low', seeds: [] };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    if (flag === '--schema') options.schema = resolve(value);
    else if (flag === '--sandbox') options.sandbox = value;
    else if (flag === '--model') options.model = value;
    else if (flag === '--effort') options.effort = value;
    else if (flag === '--seed') options.seeds.push(value);
    else throw new Error(`unknown option ${flag}`);
  }
  if (!['read-only', 'workspace-write'].includes(options.sandbox)) {
    throw new Error('--sandbox must be read-only or workspace-write');
  }
  return { name, prompt, options };
}

function codexCommand() {
  if (process.env.CODEX_BIN) return { command: process.env.CODEX_BIN, prefix: [] };
  const sdk = fileURLToPath(import.meta.resolve('@openai/codex-sdk'));
  const cli = createRequire(sdk).resolve('@openai/codex/bin/codex.js');
  return { command: process.execPath, prefix: [cli] };
}

function scrubber(workDir) {
  const replacements = [
    [realpathSync(workDir), '<WORKDIR>'],
    [workDir, '<WORKDIR>'],
    [realpathSync(tmpdir()), '<TMP>'],
    [tmpdir(), '<TMP>'],
    [homedir(), '<HOME>'],
  ];
  const scrubString = (s) => {
    let out = s;
    for (const [from, to] of replacements) {
      out = out.split(from).join(to);
      out = out.split(from.replaceAll('\\', '/')).join(to);
    }
    return out;
  };
  const walk = (v) => {
    if (typeof v === 'string') return scrubString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk;
}

const { name, prompt, options } = parseArgs(process.argv.slice(2));
const workDir = mkdtempSync(join(tmpdir(), 'gg-record-'));
for (const seed of options.seeds) {
  const eq = seed.indexOf('=');
  writeFileSync(join(workDir, seed.slice(0, eq)), seed.slice(eq + 1), 'utf8');
}
const { command, prefix } = codexCommand();
const args = [
  ...prefix,
  'exec',
  '--json',
  '--ephemeral',
  '--skip-git-repo-check',
  '-m',
  options.model,
  '-c',
  `model_reasoning_effort="${options.effort}"`,
  '-c',
  'approval_policy="never"',
  '-c',
  'web_search="disabled"',
  '-s',
  options.sandbox,
  '-C',
  workDir,
  ...(options.schema ? ['--output-schema', options.schema] : []),
  '-',
];

const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
child.stdin.end(prompt);
let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString('utf8');
});
child.on('close', (code) => {
  const scrub = scrubber(workDir);
  const lines = stdout
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.stringify(scrub(JSON.parse(l)));
      } catch {
        return null;
      }
    })
    .filter((l) => l !== null);
  lines.push(JSON.stringify({ type: 'x-recorder.exit', code }));
  const out = join(fixturesDir, `${name}.jsonl`);
  writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
  rmSync(workDir, { recursive: true, force: true });
  console.error(`wrote ${out} (${lines.length} lines, exit ${code})`);
});
