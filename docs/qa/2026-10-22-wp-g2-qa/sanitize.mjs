import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const dir = 'docs/qa/2026-10-22-wp-g2-qa',
  root = process.cwd(),
  home = process.env.USERPROFILE;
function decode(b) {
  if (b[0] === 255 && b[1] === 254) return b.subarray(2).toString('utf16le');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}
const escapeRegex = (s) =>
  s
    .split('')
    .map((c) => ('\\^$.*+?()[]{}|'.includes(c) ? '\\' + c : c))
    .join('');
for (const name of await readdir(dir)) {
  if (!/\.(txt|jsonl|json|md)$/.test(name)) continue;
  let s = decode(await readFile(join(dir, name)));
  if (name.startsWith('suite-') && !s.includes('EXIT:')) continue;
  for (const [path, label] of [
    [root, '<worktree>'],
    [home, '<user>'],
    [home.slice(2), '<user>'],
  ]) {
    for (const variant of [path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')])
      s = s.replace(new RegExp(escapeRegex(variant), 'gi'), label);
  }
  s = s.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  s = s.replace(
    /(?<![A-Za-z0-9_-])gg_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g,
    '<redacted-qa-api-key>',
  );
  await writeFile(join(dir, name), s);
}
console.log('Evidence normalized to UTF8; local profile paths and generated QA keys scrubbed.');
