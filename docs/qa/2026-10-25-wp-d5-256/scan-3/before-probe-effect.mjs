import fs from 'node:fs';
const [mode,marker]=process.argv.slice(2);
fs.appendFileSync(marker,'effect\n');
console.log('null');
