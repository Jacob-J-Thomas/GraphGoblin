import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkout, output] = process.argv.slice(2);
assert(/^(?:ae8-artifacts-before|ae8-artifacts-after)\.json$/.test(output));
assert.equal(process.version,'v22.23.4');
const root = await realpath(checkout);
const here = dirname(fileURLToPath(import.meta.url));
const worker = join(here,'..','ui-273-promotion-verification','manifests');
const head = 'ae8add8a791699e905540465b5ddf929d00c50eb';
const tree = 'ea2dfcfd46f7d5ab79fd98414db214513d830b52';
const base = 'a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c';
const hash = (bytes)=>createHash('sha256').update(bytes).digest('hex');
const git = (...args)=>execFileSync('git',args,{cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const pinned = await readFile(join(here,'baseline-binding-readonly.json'));
assert.equal(hash(pinned),'ceef83308acd18fe726ad6a3d484be5d327c6d0f66181584629b5d70d70a66a8');
const manifest = JSON.parse(pinned);
assert.equal(manifest.head,head);
assert.equal(manifest.base,base);
assert.equal(manifest.tree,tree);
assert.equal(git('rev-parse',head+'^{tree}').toString().trim(),tree);
for (const [path,expected] of Object.entries(manifest.sourceReadback)) {
  assert.equal(hash(git('show',head+':'+path)),expected,path+' immutable baseline blob');
}
async function list(directory) {
  const files = [];
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    assert(!entry.isSymbolicLink(),path);
    if (entry.isDirectory()) files.push(...await list(path));
    else { assert(entry.isFile(),path); files.push(path); }
  }
  return files;
}
let count=0;
const critical = {};
for (const [tree,expected] of Object.entries(manifest.trees)) {
  const leaf=tree.replaceAll('/','_')+'.sha256';
  const listing=await readFile(join(worker,'postbuild',leaf));
  assert.equal(hash(listing),expected.listingSha256,tree);
  assert.equal(hash(await readFile(join(worker,'final',leaf))),expected.listingSha256,tree+' final');
  const files=new Map(listing.toString().trim().split(/\r?\n/).map((line)=>{
    const row=/^([a-f0-9]{64}) \*\.\/(.+)$/.exec(line);
    assert(row,line);
    return [row[2],row[1]];
  }));
  const directory=join(root,tree);
  const current=await list(directory);
  assert.equal(current.length,expected.files,tree);
  assert.equal(files.size,expected.files,tree);
  for (const path of current) {
    const file=relative(directory,path).replaceAll('\\','/');
    const digest=hash(await readFile(path));
    assert.equal(digest,files.get(file),tree+'/'+file);
    if(tree==='apps/web/dist' || (tree==='apps/api/dist' && file==='main.js')) critical[tree+'/'+file]=digest;
  }
  count+=current.length;
}
assert.equal(count,1227);
assert.deepEqual(critical,manifest.critical);
const entry='apps/web/dist/'+manifest.bundle.replace(/^\/app\//,'');
const bundleMap=JSON.parse(await readFile(join(root,entry+'.map')));
for (const [path,digest] of Object.entries(manifest.sourceMap)) {
  const found=bundleMap.sources.findIndex((candidate)=>candidate.endsWith('/'+path.replace('apps/web/src/','')));
  assert(found>=0,path);
  assert.equal(hash(bundleMap.sourcesContent[found]),digest,path);
}
const require=createRequire(join(root,'packages/domain/package.json'));
const jsonataEntry=await realpath(require.resolve('jsonata'));
const vendorPackage=join(dirname(jsonataEntry),'package.json');
const vendor=JSON.parse(await readFile(vendorPackage));
const result={
  ...manifest, evidenceMode:'ae8 immutable-source / retained compiled-artifact baseline',
  currentWorkingSourceBound:false, originalBindingSha256:hash(pinned),
  jsonataInstallation:{entry:jsonataEntry,version:vendor.version,entrySha256:hash(await readFile(jsonataEntry)),
    packageSha256:hash(await readFile(vendorPackage))},
};
await writeFile(join(here,output),JSON.stringify(result,null,2)+'\n');
console.log('Verified retained ae8 artifacts and immutable source, not the working tree: 1227 files across 13 trees.');
