import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const directory=process.argv[2];
const sha=(data)=>createHash('sha256').update(data).digest('hex');
const read=(p)=>readFile(join(directory,p),'utf8');
const put=(p,d)=>writeFile(join(directory,p),d,{flag:'wx'});
const path='drivers/space.playwright.js';
const manifestPath='driver-manifest.json';
const ledger='fixture-corrections.json';
const priorManifest=await read(manifestPath);
const admission=JSON.parse(await read('admission-native-authorized.json'));
assert.equal(sha(priorManifest),admission.driverManifestSha256);
const manifest=JSON.parse(priorManifest);
assert.equal(manifest.files[path],sha(await read(path)));
assert.deepEqual(JSON.parse(await read(ledger)),[]);

const initial=await read('runs/alternate-r512-initial/observed.json');
const parsed=JSON.parse(initial);
assert.equal(parsed.summary.writes,0);
assert(parsed.failure.error.includes('owns the same R512 x93 y290 hit'));
const coordinatePath='runs/alternate-r512-initial/raw/0006-alternate-single-healthy-coordinates.json';
const coords=JSON.parse(await read(coordinatePath));
assert.deepEqual(coords.point,[93,319]);
assert.equal(coords.ownsHit,true);

await copyFile(join(directory,manifestPath),join(directory,'driver-manifest-initial.json'));
const before=await read(path);
const match="      async function action(label,doubled){\n        const prior=await newFixture(label);";
const replacement="      async function action(label,doubled){\n        const prior=await newFixture('double-r512');";
assert.equal(before.split(match).length,2);
const corrected=before.replace(match,replacement);
assert.equal(corrected.replace(replacement,match),before);
await writeFile(join(directory,path),corrected);
const correction=[{
  attempt:'correction1',groups:['alternate-r512'],scope:'Global #208 fixture correction batch 1 of 2',
  authorizedBy:'/root',authorization:'Explicit root dispatch after reviewing the initial failure and driver patch',
  firstEvidence:'runs/alternate-r512-initial/observed.json',firstEvidenceSha256:sha(initial),
  firstCoordinateEvidence:coordinatePath,firstCoordinateSha256:sha(await read(coordinatePath)),
  fixtureCause:'Long diagnostic fixture title wrapped the toolbar and displaced the original (93,290) target by 29 CSS px before any input.',
  fixtureChange:"Use newFixture('double-r512') in both fresh loops; leave coordinate, gesture, viewport, draft and history gates intact.",
  inputSent:false,
}];
await writeFile(join(directory,ledger),JSON.stringify(correction,null,2)+'\n');
manifest.version='space-208-alternate-double-v1-correction1';
manifest.files[path]=sha(corrected);
manifest.files[ledger]=sha(await read(ledger));
manifest.files['correction1-note.md']=sha(await read('correction1-note.md'));
const content=JSON.stringify(manifest,null,2)+'\n';
await writeFile(join(directory,manifestPath),content);
admission.nativeGrant.fixtureCorrection=correction[0];
admission.driverManifestSha256=sha(content);
await put('admission-correction1-authorized.json',JSON.stringify(admission,null,2)+'\n');
console.log(JSON.stringify({driverManifestSha256:admission.driverManifestSha256,correctedDriverSha256:manifest.files[path]}));

