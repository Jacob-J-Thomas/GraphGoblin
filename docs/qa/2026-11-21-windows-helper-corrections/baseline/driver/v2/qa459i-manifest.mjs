// QA459I deterministic manifest. Not product code.
// node qa459i-manifest.mjs <directory> <manifest-file-name> [--verify]
// Lists "<sha256>  <bytes>  <relative/path>" for every file under <directory>, sorted by the
// forward-slash relative path with LF line endings, excluding the manifest file itself.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const [directory, name] = process.argv.slice(2);
const verify = process.argv.includes('--verify');
const files = [];
const walk = (path) => {
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(directory);
const lines = files
  .map((full) => ({ full, rel: relative(directory, full).replace(/\\/g, '/') }))
  .filter(({ rel }) => rel !== name)
  .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  .map(({ full, rel }) => {
    const bytes = readFileSync(full);
    return `${createHash('sha256').update(bytes).digest('hex')}  ${bytes.length}  ${rel}`;
  });
const text = lines.join('\n') + '\n';
const target = join(directory, name);
if (verify) {
  const ok = existsSync(target) && readFileSync(target, 'utf8') === text;
  console.log(ok ? `manifest verified: ${lines.length} entries` : 'MANIFEST MISMATCH');
  process.exit(ok ? 0 : 1);
}
if (existsSync(target)) throw new Error('manifest exists; never overwritten');
writeFileSync(target, text);
console.log(`${lines.length} entries; manifest sha256 ${createHash('sha256').update(text).digest('hex')}`);
