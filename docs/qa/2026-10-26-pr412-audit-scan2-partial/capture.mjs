import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';

const [label, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label) || !args.length) throw Error('label and pnpm args required');
const executable = process.env.PATH.split(delimiter)
  .map((path) => join(path, 'node_modules', 'pnpm', 'pnpm.exe'))
  .find(existsSync);
if (!executable) throw Error('pnpm executable missing');
const redact = (value) => {
  for (const path of [homedir(), homedir().replaceAll('\\', '/')])
    value = value.split(path).join('%USERPROFILE%');
  return value.split(hostname()).join('%COMPUTERNAME%').replace(/S-\d(?:-\d+){2,}/g, '<SID>');
};
const lines = [`pnpm.cmd ${args.join(' ')}`, `Runtime ${process.version} ${process.execPath}`];
const child = spawn(executable, args, { windowsHide: true });
for (const stream of [child.stdout, child.stderr])
  createInterface({ input: stream }).on('line', (line) => lines.push(line));
child.once('error', (error) => lines.push(String(error)));
child.once('close', async (code) => {
  lines.push(`EXIT ${code}`);
  const output = redact(lines.join('\n') + '\n');
  if (Buffer.byteLength(output) > 1_000_000) throw Error('Capture exceeds evidence limit');
  await writeFile(new URL(`${label}.log.txt`, import.meta.url), output, 'utf8');
  process.stdout.write(redact(lines.slice(-18).join('\n')) + '\n');
  process.exitCode = code ?? 1;
});
