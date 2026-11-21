import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const evidence = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i4-442-discovery-01';
const repo = 'G:/ggq/gg-i4-442-plugin-diagnostics/GraphGoblin';
const sdk = fileURLToPath(import.meta.resolve('@openai/codex-sdk', pathToFileURL(join(repo, 'packages/adapter-codex/src/cli.ts')).href));
const launcher = createRequire(sdk).resolve('@openai/codex/bin/codex.js');
const root = await mkdtemp('G:/ggq/gg442-help-');
const home = join(root, 'home');
const work = join(root, 'work');
await Promise.all([mkdir(home), mkdir(work)]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC)$/i.test(key)));
Object.assign(env, { CODEX_HOME: home, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home });
const results = [];
for (const args of [
  ['--version'], ['--help'], ['plugin', '--help'], ['plugin', 'list', '--help'],
  ['plugin', 'marketplace', '--help'], ['plugin', 'marketplace', 'add', '--help'],
  ['mcp', '--help'], ['mcp', 'list', '--help'], ['debug', '--help'],
  ['features', '--help'], ['app-server', '--help'],
  ['debug', 'app-server', '--help'], ['debug', 'prompt-input', '--help'],
  ['app-server', 'generate-json-schema', '--help'], ['plugin', 'add', '--help'],
  ['app-server', 'generate-json-schema', '--out', join(root, 'schema')],
  ['app-server', 'generate-json-schema', '--experimental', '--out', join(root, 'schema-experimental')],
]) {
  const started = Date.now();
  const outcome = await new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const child = spawn(process.execPath, [launcher, ...args], { cwd: work, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout, stderr }); });
  });
  results.push({ args, ...outcome, elapsedMs: Date.now() - started });
  console.log(JSON.stringify({ args, code: outcome.code, elapsedMs: Date.now() - started }));
}
await writeFile(join(evidence, 'cli-help-and-schema.json'), JSON.stringify({ root, repo, sdk, launcher, node: process.version, results }, null, 2) + '\n');
console.log(JSON.stringify({ evidence: join(evidence, 'cli-help-and-schema.json'), root }));
