// Copy a captured text file into the record with the profile path, machine name, SIDs and
// credential-shaped strings redacted (lib.mjs `redact`), as UTF-8 without BOM.
//   node redact-file.mjs <source> <record file name>
import fs from 'node:fs';
import path from 'node:path';
import { OUT, redact } from './lib.mjs';

const [source, name] = process.argv.slice(2);
// Strip terminal colour codes as well.
const text = fs.readFileSync(source, 'utf8').replace(/\u001b\[[0-9;]*m/g, '');
fs.writeFileSync(path.join(OUT, name), redact(text));
console.log(`${name}: ${Buffer.byteLength(redact(text))} bytes`);
