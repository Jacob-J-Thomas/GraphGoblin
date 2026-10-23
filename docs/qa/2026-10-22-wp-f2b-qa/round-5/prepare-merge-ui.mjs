import { readFile, writeFile } from 'node:fs/promises';
const here = new URL('.', import.meta.url);
let helpers = (await readFile(new URL('observed-served-checks.mjs', here), 'utf8')).split(
  'const failure =',
)[0];
helpers = helpers
  .replaceAll("'served-results.json'", "'merge-results.json'")
  .replaceAll("'served-timings.json'", "'merge-timings.json'")
  .replace('width: 1440, height: 1000', 'width, height: width===390?844:1000');
const tail = await readFile(new URL('merge-ui-tail.mjs.txt', here), 'utf8');
await writeFile(new URL('merge-ui.mjs', here), helpers + tail);
console.log('Merge UI script prepared.');
