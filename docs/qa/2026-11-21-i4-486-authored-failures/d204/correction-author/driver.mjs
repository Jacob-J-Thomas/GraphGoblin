import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-review-fixes-author-01';
const cwd = 'G:\\ggq\\gg-i4-486-review-fixes\\GraphGoblin';
const scratch = 'G:\\ggq\\qa-scratch\\i4-486-review-fixes-author-01';
const runtime = 'C:\\Users\\98jak\\.claude\\codex-runs\\GraphGoblin\\runtime\\node-v22.23.4-win-x64';
mkdirSync(scratch, { recursive: true });
const initialIndex = join(root, 'initial-index.json');
if (!existsSync(initialIndex)) {
  const indexPath = spawnSync('git.exe', ['rev-parse', '--git-path', 'index'], { cwd, encoding: 'utf8' }).stdout.trim();
  writeFileSync(initialIndex, JSON.stringify({ path: indexPath, sha256: createHash('sha256').update(readFileSync(indexPath)).digest('hex') }, null, 2));
}
const [name, scriptPath] = process.argv.slice(2);
const destination = join(root, 'commands', name);
mkdirSync(destination, { recursive: true });
const script = readFileSync(scriptPath, 'utf8');
writeFileSync(join(destination, 'command.ps1'), script);
const start = new Date().toISOString();
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath], {
  cwd,
  env: { ...process.env, PATH: `${runtime};${process.env.PATH}`, TEMP: scratch, TMP: scratch },
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
writeFileSync(join(destination, 'stdout.txt'), result.stdout ?? '');
writeFileSync(join(destination, 'stderr.txt'), result.stderr ?? '');
writeFileSync(join(destination, 'result.json'), JSON.stringify({ start, end: new Date().toISOString(), cwd, node: process.execPath, runtime: process.version, TEMP: scratch, TMP: scratch, status: result.status, signal: result.signal, error: result.error?.message }, null, 2));
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
