const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const folder = path.join(process.cwd(), 'docs/qa');
const snapshot = path.join(process.env.TEMP, 'gg-chore-web-evidence-bytes.json');
function walk(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
const hashes = Object.fromEntries(walk(folder).filter(f => /\.(json|ya?ml|[cm]?[jt]s)$/.test(f)).map(f => [path.relative(process.cwd(),f).replaceAll('\\','/'),crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
if (process.argv[2] === 'snapshot') { fs.writeFileSync(snapshot,JSON.stringify(hashes)); console.log('Snapshotted',Object.keys(hashes).length,'raw QA artifacts.'); }
else { const before = JSON.parse(fs.readFileSync(snapshot)); const changed = Object.keys(before).filter(f => hashes[f] !== before[f]); console.log(JSON.stringify({checked:Object.keys(before).length,changed})); process.exitCode=changed.length?1:0; }
