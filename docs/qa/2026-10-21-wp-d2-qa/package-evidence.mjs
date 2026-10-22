import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
const folder = join(process.cwd(), 'docs/qa/2026-10-21-wp-d2-qa');
function sanitize(value) {
  let s = value.replaceAll('\0', '').replace(/^\uFFFD+/, '');
  for (const [path, token] of [
    [process.cwd(), '%WORKTREE%'],
    [process.env.TEMP, '%TEMP%'],
    [process.env.USERPROFILE, '%USERPROFILE%'],
  ]) {
    for (const p of [path, path.replaceAll('\\', '/'), JSON.stringify(path).slice(1, -1)])
      s = s.replaceAll(p, token);
  }
  s = s.replace(
    /"pnpm recursive (?:run|exec)" failed in C:[\s\S]*$/,
    'pnpm workspace command failed.\n',
  );
  return s;
}
for (const entry of await readdir(folder)) {
  if (!/\.(json|log|md)$/.test(entry)) continue;
  const path = join(folder, entry);
  const bytes = await readFile(path);
  const text =
    bytes[0] === 255 && bytes[1] === 254
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8');
  const destination = entry.replace('.raw.log', '.log');
  await writeFile(join(folder, destination), sanitize(text));
  if (entry !== destination) await unlink(path);
}
