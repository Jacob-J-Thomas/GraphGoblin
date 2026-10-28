// Reviewer evidence hygiene (WP-425 scan 2): rewrite every text file under review-2/ as UTF-8
// without BOM, with the profile path (all spellings), user name, machine name and Windows SIDs
// redacted, and report any file over 1,000,000 bytes.   node sanitize.mjs <review-2 dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.resolve(process.argv[2]);
const home = os.homedir();
const user = path.basename(home);
const spellings = [
  home,
  home.replaceAll('\\', '/'),
  home.replaceAll('\\', '\\\\'),
  '/' + home[0].toLowerCase() + home.slice(2).replaceAll('\\', '/'),
];
const text = /\.(txt|json|md|mjs|mts|ps1)$/;
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
  );
for (const file of walk(dir)) {
  const size = fs.statSync(file).size;
  if (size > 1_000_000) console.log(`OVER 1,000,000 bytes: ${path.relative(dir, file)} ${size}`);
  if (!text.test(file)) continue;
  let body = fs.readFileSync(file);
  let s = body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? body.subarray(3).toString('utf8') : body.toString('utf8');
  for (const spelling of spellings) s = s.split(spelling).join('%USERPROFILE%');
  s = s.replace(new RegExp(os.hostname(), 'gi'), '%COMPUTERNAME%');
  s = s.replace(/S-1-5-21-[\d-]+/g, '<SID>');
  s = s.replace(new RegExp(`\\b${user}\\b`, 'g'), '%USERNAME%');
  fs.writeFileSync(file, s);
}
console.log('sanitized', dir);
