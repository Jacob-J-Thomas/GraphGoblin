#!/usr/bin/env node
// Run a Codex CLI session as a development worker in its own git worktree.
//
//   node .claude/scripts/codex-task.mjs --name <slug> --prompt <file> [--model gpt-6.1-sol]
//        [--effort xhigh|low|...] [--base main] [--resume] [--raw] [--no-worktree]
//
// Creates (or reuses) the worktree `.claude/worktrees/codex-<slug>` on branch `codex-<slug>`
// from `--base`, pipes the prompt file to `codex exec`, and writes a compact
// `.claude/codex-runs/<slug>/summary.md` (thread id, commands run, files changed, final
// message, usage). `--resume` continues the slug's previous thread with the new prompt.
// The raw JSONL event stream is discarded unless `--raw` is given, to save disk.
//
// Sandbox: workspace-write with network on, plus write access to the pnpm store, the
// repository's .git (so commits in the worktree work), and the temp directory.
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.name || !args.prompt) {
  console.error('usage: codex-task.mjs --name <slug> --prompt <file> [--model m] [--effort e] [--base ref] [--resume] [--raw] [--no-worktree]');
  process.exit(2);
}
const model = args.model ?? 'gpt-6.1-sol';
const effort = args.effort ?? 'xhigh';
const base = args.base ?? 'main';
const repo = git(['rev-parse', '--show-toplevel']).trim();
const slug = args.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const runDir = path.join(repo, '.claude', 'codex-runs', slug);
mkdirSync(runDir, { recursive: true });

let cwd = repo;
if (!args['no-worktree']) {
  cwd = path.join(repo, '.claude', 'worktrees', `codex-${slug}`);
  const branch = `codex-${slug}`;
  if (!existsSync(cwd)) {
    const branchExists = git(['branch', '--list', branch]).trim() !== '';
    git(branchExists ? ['worktree', 'add', cwd, branch] : ['worktree', 'add', '-b', branch, cwd, base]);
  }
}

const prompt = readFileSync(args.prompt, 'utf8');
writeFileSync(path.join(runDir, 'prompt.md'), prompt);
const threadFile = path.join(runDir, 'thread-id');
const previousThread = args.resume && existsSync(threadFile) ? readFileSync(threadFile, 'utf8').trim() : '';

const codexJs = process.env.CODEX_JS ?? path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).trim(), '@openai', 'codex', 'bin', 'codex.js');
const pnpmStore = path.dirname(path.dirname(execFileSync('pnpm', ['store', 'path'], { encoding: 'utf8', shell: true }).trim()));

const codexArgs = [
  codexJs,
  'exec',
  '--cd', cwd,
  '-m', model,
  '-c', `model_reasoning_effort="${effort}"`,
  '-s', 'workspace-write',
  '-c', 'approval_policy="never"',
  '-c', 'sandbox_workspace_write.network_access=true',
  '-c', 'web_search="disabled"',
  '--add-dir', pnpmStore,
  '--add-dir', path.join(repo, '.git'),
  '--add-dir', os.tmpdir(),
  '--json',
  '-o', path.join(runDir, 'last.md'),
];
if (previousThread) codexArgs.push('resume', previousThread);
codexArgs.push('-');

const startedAt = Date.now();
const child = spawn(process.execPath, codexArgs, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
child.stdin.end(prompt);

const raw = args.raw ? createWriteStream(path.join(runDir, 'events.jsonl')) : null;
const commands = [];
const files = new Set();
const errors = [];
let threadId = previousThread;
let usage = null;
let finalMessage = '';
let buffer = '';
child.stdout.on('data', (chunk) => {
  raw?.write(chunk);
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(line);
  }
});
let stderr = '';
child.stderr.on('data', (c) => { stderr += c.toString(); if (stderr.length > 20_000) stderr = stderr.slice(-20_000); });

function handle(line) {
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  if (ev.type === 'thread.started' && ev.thread_id) threadId = ev.thread_id;
  if (ev.type === 'turn.completed' && ev.usage) usage = ev.usage;
  if (ev.type === 'turn.failed') errors.push(`turn.failed: ${ev.error?.message ?? ''}`.slice(0, 500));
  if (ev.type === 'error') errors.push(`error: ${ev.message ?? ''}`.slice(0, 500));
  if (ev.type === 'item.completed' && ev.item) {
    const it = ev.item;
    if (it.type === 'agent_message') finalMessage = it.text ?? finalMessage;
    if (it.type === 'command_execution') commands.push(`${it.exit_code ?? '?'}  ${String(it.command ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
    if (it.type === 'file_change') for (const c of it.changes ?? []) files.add(`${c.kind ?? 'update'} ${c.path}`);
    if (it.type === 'error') errors.push(`item.error: ${it.message ?? ''}`.slice(0, 500));
  }
}

child.on('close', (code) => {
  raw?.end();
  if (threadId) writeFileSync(threadFile, threadId);
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const summary = [
    `# Codex task: ${slug}`,
    '',
    `- model: ${model} (${effort})`,
    `- worktree: ${cwd}`,
    `- thread: ${threadId || '(unknown)'}`,
    `- exit code: ${code}, duration: ${minutes} min`,
    usage ? `- usage: in ${usage.input_tokens} (cached ${usage.cached_input_tokens ?? 0}), out ${usage.output_tokens} (reasoning ${usage.reasoning_output_tokens ?? 0})` : '- usage: (none)',
    '',
    `## Commands (${commands.length})`,
    '',
    ...commands.slice(-80).map((c) => `- ${c}`),
    '',
    `## Files changed (${files.size})`,
    '',
    ...[...files].sort().map((f) => `- ${f}`),
    '',
    `## Errors (${errors.length})`,
    '',
    ...errors.map((e) => `- ${e}`),
    '',
    '## Final message',
    '',
    finalMessage || '(no agent message; see last.md)',
    '',
    stderr.trim() ? `## stderr (tail)\n\n\`\`\`\n${stderr.trim().slice(-4000)}\n\`\`\`\n` : '',
  ].join('\n');
  writeFileSync(path.join(runDir, 'summary.md'), summary);
  console.log(summary);
  process.exit(code ?? 1);
});

function git(a) {
  return execFileSync('git', a, { encoding: 'utf8', cwd: process.cwd() });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
