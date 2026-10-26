// Collect this round's retained logs without replacing them with summaries.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repo = process.cwd();
const target = path.dirname(fileURLToPath(import.meta.url));
const clean = (text) => {
  text = text.replace(/([A-Za-z]:[\\/])\r?\n(?=Users[\\/])/g, '$1');
  for (const [from, to] of [
    [repo, '<worktree>'],
    [process.env.TEMP, '<temp>'],
    [process.env.USERPROFILE, '<user>'],
  ])
    for (const p of [from, from.replaceAll('\\', '/'), from.replaceAll('\\', '\\\\')])
      text = text.split(p).join(to);
  return text
    .replace(/C:\r?\n[^\r\n]*\\Users\\[^\r\n]+[^\r\n]*\r?\n[^\r\n]*/g, '<worktree>')
    .replace(/\r\n/g, '\n');
};
const read = (p) => {
  const b = fs.readFileSync(p);
  return (b[0] === 255 && b[1] === 254 ? b.toString('utf16le') : b.toString('utf8')).replace(
    /^\uFEFF/,
    '',
  );
};
const hashes = [];
for (const file of fs
  .readdirSync(repo)
  .filter((f) => /^round8-.*\.log$/.test(f) && f !== 'round8-loops-fixed.log')) {
  const bytes = fs.readFileSync(file),
    text = clean(read(file)),
    name = file + '.txt';
  fs.writeFileSync(path.join(target, name), text);
  hashes.push({
    source: '<worktree>/' + file,
    retained: name,
    originalSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    retainedSha256: crypto.createHash('sha256').update(text).digest('hex'),
    normalization:
      'Console logs converted to UTF-8 and LF; local path prefixes normalized. Raw JSON reporters retain their complete objects.',
  });
}
for (const [dir, label] of process.argv.slice(2).map((v) => v.split('='))) {
  for (const file of fs.readdirSync(path.join(process.env.TEMP, dir))) {
    if (!/\.(json|jsonl|log|txt|png)$/.test(file)) continue;
    const source = path.join(process.env.TEMP, dir, file);
    if (!fs.statSync(source).isFile()) continue;
    const name = label + '-' + file.replace(/\.log$/, '.log.txt');
    if (file.endsWith('.png')) fs.copyFileSync(source, path.join(target, name));
    else fs.writeFileSync(path.join(target, name), clean(read(source)));
    hashes.push({
      source: '<temp>/' + dir + '/' + file,
      retained: name,
      originalSha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
      retainedSha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(target, name)))
        .digest('hex'),
      normalization: file.endsWith('.png')
        ? 'None; original PNG.'
        : 'Local paths, UTF-8 and LF only.',
    });
  }
}
fs.writeFileSync(
  path.join(target, 'retention-manifest.json'),
  JSON.stringify(hashes, null, 2) + '\n',
);
console.log(JSON.stringify({ retained: hashes.length }));
