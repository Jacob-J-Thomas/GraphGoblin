const fs = require('node:fs');
const path = require('node:path');
const {stripVTControlCharacters} = require('node:util');
const result = [];
for (const [phase, folder] of [['audit', 'gg-audit-chore-384-round2-b06832a'], ['before', 'gg-chore-web-round3-before'], ['after', 'gg-chore-web-round3-after']]) {
  const directory = path.join(process.env.TEMP, folder);
  if (!fs.existsSync(directory)) continue;
  const files = fs.readdirSync(directory).filter(file => file.endsWith('.log.txt') && (file.startsWith('verified-') || file.startsWith('ordinary') || file.startsWith('controlled-probes')));
  for (const file of files) {
    const text = stripVTControlCharacters(fs.readFileSync(path.join(directory, file), 'utf8'));
    const lines = text.split(/\r?\n/);
    result.push({phase, file, summary: lines.filter(line => /^\s*(Test Files|Tests|Duration)\s/.test(line)), coverage: lines.filter(line => /^(Statements|Branches|Functions|Lines)\s+:/.test(line)), failures: lines.filter(line => /^\s*FAIL\s/.test(line)), targetCases: lines.filter(line => line.includes(' > ') && /converts a v1 draft|keeps a set-aside device copy across edits|colours JSON keys/.test(line))});
  }
}
const destination = path.join(process.env.TEMP, 'gg-chore-web-round3-summary.json');
fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
