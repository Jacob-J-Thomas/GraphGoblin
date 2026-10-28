// Copy captured command output into the record as redacted UTF-8 `.log.txt` (profile path,
// machine name, SIDs, tokens), stripping terminal colour codes. Usage:
//   node redact-copy.mjs <source file> <record file name>
import fs from 'node:fs';
import path from 'node:path';
import { OUT, redact } from './lib.mjs';

const [source, name] = process.argv.slice(2);
if (!source || !name?.endsWith('.log.txt')) throw new Error('usage: redact-copy <source> <name.log.txt>');
const text = fs.readFileSync(source, 'utf8').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
const target = path.join(OUT, name);
fs.writeFileSync(target, redact(text));
console.log(`${name}: ${Buffer.byteLength(fs.readFileSync(target))} bytes`);
