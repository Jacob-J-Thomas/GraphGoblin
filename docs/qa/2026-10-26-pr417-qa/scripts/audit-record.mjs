// Audits this record before hand-off: every file under 1,000,000 bytes, text files UTF-8 without
// the profile path, the machine name or Windows SIDs, and a check summary of every result file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const record = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const needles = [home, home.replaceAll('\\', '/'), home.replaceAll('\\', '\\\\'), '/c' + home.slice(2).replaceAll('\\', '/'), os.hostname()];
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(record);
let problems = 0;
for (const f of files) {
  const rel = path.relative(record, f);
  const size = fs.statSync(f).size;
  if (size >= 1_000_000) {
    problems++;
    console.log(`TOO LARGE ${rel} ${size}`);
  }
  if (/\.(png)$/i.test(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  const lower = text.toLowerCase();
  for (const n of needles)
    if (lower.includes(n.toLowerCase())) {
      problems++;
      console.log(`UNREDACTED ${rel}: ${n === os.hostname() ? 'machine name' : 'profile path'}`);
    }
  if (/S-1-5-21-\d/.test(text)) {
    problems++;
    console.log(`SID ${rel}`);
  }
  if (text.includes(String.fromCharCode(0xfffd))) {
    problems++;
    console.log(`NOT UTF-8 ${rel}`);
  }
}
console.log(`${files.length} files, ${problems} problems`);
for (const f of files.filter((x) => x.endsWith('-result.json') && !x.includes('attempts'))) {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`${path.basename(f)}: ${r.passed} passed, ${r.failed} failed`);
}
