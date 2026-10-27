// UTF-8, redacted gate capture; run with the project's Node runtime from the repo root.
import { spawn } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { appendFile, readFile, rename, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';

const [label, ...args] = process.argv.slice(2);
if (!label || !/^[a-z0-9-]+$/.test(label) || args.length === 0)
  throw Error('label and pnpm arguments required');
const directory = new URL('./', import.meta.url);
const file = new URL(`${label}.log.txt`, directory);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const profiles = new RegExp(escape(homedir()).replaceAll('\\\\', '[\\\\/]'), 'gi');
const wrappedProfile = new RegExp(
  '(?:[A-Za-z]:)?[\\\\/]+Users[\\\\/]+' + escape(basename(homedir())),
  'gi',
);
const redact = (value) =>
  value
    .replace(profiles, '%USERPROFILE%')
    .replace(wrappedProfile, '%USERPROFILE%')
    .replaceAll(hostname(), '%COMPUTERNAME%')
    .replace(/S-\d(?:-\d+){2,}/g, '<SID>');
const lines = [];
const writer = createWriteStream(file, { encoding: 'utf8' });
const save = (line) => {
  const safe = redact(line);
  lines.push(safe);
  if (lines.length > 12) lines.shift();
  writer.write(safe + '\n');
};
// The Windows pnpm.cmd shim calls this standalone executable. Direct invocation preserves
// argument boundaries (including test-name patterns) and still uses Node first on PATH.
const executable =
  process.platform === 'win32'
    ? process.env.PATH.split(delimiter)
        .map((path) => join(path, 'node_modules', 'pnpm', 'pnpm.exe'))
        .find(existsSync)
    : 'pnpm';
if (!executable) throw Error('pnpm standalone executable not found');
const child = spawn(executable, args, { windowsHide: true });
let stopTask;
// A formatter that stops making progress must not prevent the remaining gates from running.
const timeout = label.includes('format')
  ? setTimeout(() => {
      save('TIMEOUT after 180000 ms; stopping only this capture child tree');
      if (process.platform === 'win32') {
        const stop = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
        });
        for (const stream of [stop.stdout, stop.stderr])
          createInterface({ input: stream }).on('line', save);
        stopTask = new Promise((resolve) => stop.once('close', resolve));
      } else child.kill('SIGTERM');
    }, 180_000)
  : undefined;
save(`pnpm ${args.join(' ')}`);
for (const stream of [child.stdout, child.stderr])
  createInterface({ input: stream }).on('line', save);
child.on('error', (error) => save(error.message));
child.on('exit', () => clearTimeout(timeout));
child.on('close', async (code) => {
  clearTimeout(timeout);
  await stopTask;
  save(`EXIT ${code}`);
  await new Promise((resolve, reject) => {
    writer.once('error', reject);
    writer.end(resolve);
  });
  const { size } = await stat(file);
  if (size > 1_000_000) {
    const hash = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    await rename(file, join(tmpdir(), `gg-wp-e3-${label}-${Date.now()}.log.txt`));
    await appendFile(
      new URL('NOT-KEPT.md', directory),
      `\n- ${label}.log.txt: ${size} bytes; SHA-256 ${hash}. Oversize capture kept only in disposable system temp.\n`,
      'utf8',
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exitCode = code ?? 1;
});
