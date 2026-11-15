import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkout,output] = process.argv.slice(2);
assert(/^(?:475-artifacts-before|475-artifacts-after)\.json$/.test(output));
assert.equal(process.version,'v22.23.4');
const root=await realpath(checkout), here=dirname(fileURLToPath(import.meta.url));
const expected=await readFile(join(here,'original-independent-binding.json'));
const hash=(bytes)=>createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(expected),'3c65233a1673a05248119180a25fdded65b799beade9d416a6243250ec8e3aa4');
const retained=JSON.parse(expected);
assert.equal(retained.head,'8fe52989e4e67be1b6416440a4c6df4605f2b676');
const head='1dcee36b16cc4662e8acb691e9166aff52949ad9';
const tree='2936f795e624932fd7d42747f8316066fa4af7ec';
const base='ae8add8a791699e905540465b5ddf929d00c50eb';
const historicalMain='a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c';
const git=(...args)=>execFileSync('git',args,{cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const sourcePaths=['apps','packages','tooling','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','patches'];
assert.equal(git('rev-parse',head+'^{tree}').toString().trim(),tree);
git('merge-base','--is-ancestor',base,head);
assert.equal(git('diff','--name-only',retained.head,head,'--',...sourcePaths).length,0);
// Retained docs changed between the two releases. Keep compiled-code source proof and the
// reviewed commit/tree attribution distinct, with no claim about the edited working source.
const sources=Object.fromEntries(Object.entries(retained.sourceReadback).filter(([path])=>path.startsWith('apps/')));
for(const [path,digest] of Object.entries(sources)) assert.equal(hash(git('show',head+':'+path)),digest,path);
async function list(directory) {
  const files=[];
  for(const item of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,item.name);
    assert(!item.isSymbolicLink(),path);
    if(item.isDirectory()) files.push(...await list(path));
    else { assert(item.isFile(),path); files.push(path); }
  }
  return files;
}
const critical={}, manifests=join(here,'..','ui-237-uncertainty-correction','manifests','postbuild');
let count=0;
for(const [tree,entry] of Object.entries(retained.trees)) {
  const manifest=await readFile(join(manifests,tree.replaceAll('/','_')+'.sha256'));
  assert.equal(hash(manifest),entry.listingSha256,tree);
  const hashes=new Map(manifest.toString().trim().split(/\r?\n/).map((line)=>{
    const row=/^([a-f0-9]{64}) \*\.\/(.+)$/.exec(line);
    assert(row,line);
    return [row[2],row[1]];
  }));
  const dir=join(root,tree), actual=await list(dir);
  assert.equal(actual.length,entry.files,tree);
  assert.equal(hashes.size,entry.files,tree);
  for(const path of actual) {
    const rel=relative(dir,path).replaceAll('\\','/'), digest=hash(await readFile(path));
    assert.equal(digest,hashes.get(rel),tree+'/'+rel);
    if(tree==='apps/web/dist' || (tree==='apps/api/dist' && rel==='main.js')) critical[tree+'/'+rel]=digest;
  }
  count+=actual.length;
}
assert.equal(Object.keys(retained.trees).length,13);
assert.equal(count,1227);
assert.deepEqual(critical,retained.critical);
const bundleMap=JSON.parse(await readFile(join(root,'apps/web/dist',retained.bundle.replace('/app/','')+'.map')));
const runtime=['usePublish.ts','EditorPage.tsx','useAutosave.ts','EditorToolbar.tsx','ValidationIndicator.tsx','ConflictNotice.tsx'];
for(const tail of runtime.map((file)=>'editor/'+file).concat('api/queries.ts')) {
  const index=bundleMap.sources.findIndex((file)=>file.endsWith('/'+tail));
  assert(index>=0,tail);
  assert.equal(hash(bundleMap.sourcesContent[index]),sources['apps/web/src/'+tail],tail);
}
const require=createRequire(join(root,'apps/web/package.json'));
const core=await realpath(require.resolve('@tanstack/react-query/package.json'));
const query=JSON.parse(await readFile(core));
assert.equal(query.version,'5.104.0');
const result={...retained,head,tree,base,historicalMain,builtSource:retained.builtSource,
  independentlyTestedSource:retained.head,evidenceMode:'1dcee immutable-source / retained compiled-artifact baseline',
  currentWorkingSourceBound:false,originalBindingSha256:hash(expected),sourceReadback:sources,
  reactQuery:{version:query.version,manifestSha256:hash(await readFile(core))},
};
await writeFile(join(here,output),JSON.stringify(result,null,2)+'\n');
console.log('Verified all 1,227 retained build files and immutable 1dcee/8fe5 source equivalence.');
