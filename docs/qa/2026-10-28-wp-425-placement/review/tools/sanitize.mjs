// Copy reviewer evidence into the record: UTF-8 without BOM, ANSI codes removed, the profile
// path (also JSON-escaped and forward-slashed), user name, machine name and SIDs redacted.
// node sanitize.mjs <destination dir> <file>...
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [dest, ...files] = process.argv.slice(2);
fs.mkdirSync(dest, { recursive: true });
const home = os.homedir();
const user = path.basename(home);
const variants = [home, home.replaceAll('\\', '/'), home.replaceAll('\\', '\\\\'), '/c' + home.slice(2).replaceAll('\\', '/')];
const redact = (text) => {
  let t = text.replace(/^﻿/, '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  for (const v of variants) t = t.split(v).join('%USERPROFILE%');
  t = t.replace(new RegExp(os.hostname(), 'gi'), '%COMPUTERNAME%');
  t = t.replace(/S-1-5-21-[0-9-]+/g, '<SID>');
  t = t.replace(new RegExp(`\\b${user}\\b`, 'g'), '%USERNAME%');
  return t;
};
for (const file of files) {
  const text = redact(fs.readFileSync(file, 'utf8'));
  const out = path.join(dest, path.basename(file));
  fs.writeFileSync(out, text, { encoding: 'utf8' });
  const size = fs.statSync(out).size;
  if (size >= 1_000_000) throw new Error(`${out} is ${size} bytes`);
  console.log(`${path.basename(file)} ${size} bytes`);
}
