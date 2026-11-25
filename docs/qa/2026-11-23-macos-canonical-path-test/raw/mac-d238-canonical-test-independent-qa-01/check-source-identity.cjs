const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = 'G:/ggq/gg-mac-d238-alias-qa/GraphGoblin';
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const old = fs.readFileSync(path.join(__dirname,'PARENT-main.test.ts'));
const corrected = fs.readFileSync(path.join(root,'apps/api/src/main.test.ts'));
const overlay = fs.readFileSync(path.join(root,'apps/api/src/main.d238-parent.independent.qa.test.ts'));
const changes = [
 ['access, mkdir, readFile, readdir, writeFile', 'access, mkdir, readFile, readdir, realpath, writeFile'],
 ['const databaseLock = `${database}.graphgoblin.lock`;', 'const databaseLock = `${await realpath(database)}.graphgoblin.lock`;'],
];
let expected = old.toString('utf8');
for (const [before,after] of changes) { if (expected.split(before).length !== 2) throw new Error('Expected one exact source substitution.'); expected = expected.replace(before,after); }
if (!old.equals(overlay) || !Buffer.from(expected).equals(corrected)) throw new Error('Immutable parent overlay or exact two-line correction changed.');
const entry = path.join(root,'apps/api/dist/main.js');
const report = { utc:new Date().toISOString(), parentSha256:sha(old), overlaySha256:sha(overlay), correctedSha256:sha(corrected), exactTwoSubstitutions:true, assertionsOtherwiseByteIdentical:true, entry, entrySha256:sha(fs.readFileSync(entry)), lockSha256:sha(fs.readFileSync(path.join(root,'pnpm-lock.yaml'))), node:{path:process.execPath,version:process.version,sha256:sha(fs.readFileSync(process.execPath))} };
fs.writeFileSync(path.join(__dirname,'SOURCE-IDENTITY.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
