import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const audit=dirname(fileURLToPath(import.meta.url));
const repo='C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin';
const native=join(repo,'docs/qa/2026-11-15-history-controls-final-native');
const bound=JSON.parse(await readFile(join(native,'binding/read-only-after.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=[];
for(const [directory,expected] of Object.entries(bound.trees)) {
  const files={};
  async function collect(dir) {
    for(const entry of await readdir(join(repo,dir),{withFileTypes:true})) {
      assert(!entry.isSymbolicLink());
      const path=dir+'/'+entry.name;
      if(entry.isDirectory())await collect(path);
      else { assert(entry.isFile()); files[path]=hash(await readFile(join(repo,path))); }
    }
  }
  await collect(directory);
  const listing=Object.keys(files).sort().map(p=>files[p]+' *'+p).join('\n')+'\n';
  assert.equal(Object.keys(files).length,expected.files);
  assert.equal(hash(listing),expected.listingSha256);
  assert.equal(listing,await readFile(join(native,'manifests',directory.replaceAll('/','_')+'.sha256'),'utf8'));
  rows.push({directory,...expected});
}
const result={at:new Date().toISOString(),status:'PASS',files:rows.reduce((n,r)=>n+r.files,0),trees:rows.length,rows};
await writeFile(join(audit,'output-tree-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,files:result.files,trees:result.trees}));
