import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const normalize = text => text.replaceAll(process.env.USERPROFILE, '%USERPROFILE%').replaceAll(process.env.USERPROFILE.replaceAll('\\', '/'), '%USERPROFILE%');
const evidence=resolve('docs/qa/2026-10-25-wp-a2-241-qa/evidence');
const seed=JSON.parse(await readFile(join(evidence,'seed-manifest.json'),'utf8'));
const expand=p=>p.replace('%USERPROFILE%',process.env.USERPROFILE);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const index=await readFile(join(expand(seed.source),'index.html'));
const normalIndexSha256=sha(index);
if(normalIndexSha256!==seed.originalSha256)throw new Error('Normal index changed');
const result={normalIndexSha256,expectedSha256:seed.originalSha256,normalIndexUnchanged:true,productionChangedPaths:execFileSync('git',['diff','--name-only','--','.',':!docs/qa'],{encoding:'utf8'}).trim()};
await writeFile(join(evidence,'seed-verification.json'),JSON.stringify(result,null,2)+'\n');
async function walk(path){
 for(const entry of await readdir(path,{withFileTypes:true})){
  const file=join(path,entry.name);
  if(entry.isDirectory())await walk(file);
  else if(entry.name==='error-context.md'){
   let text=await readFile(file,'utf8');
   text=normalize(text);
   await writeFile(join(evidence,'seed-error-context.log.txt'),'Source: error-context.md from the seeded test output; path-normalized text, not a retained Playwright output folder.\n'+text);
  }
 }
}
await walk(expand(seed.outputFolder));
for(const entry of await readdir(evidence)){
 const path=join(evidence,entry);
 if(entry.endsWith('.log.txt')){
  const before=await readFile(path,'utf8');
  const after=normalize(before);
  if(after!==before)await writeFile(path,after);
 }else if(entry.endsWith('.result.json')){
  const value=JSON.parse(await readFile(path,'utf8').then(x=>x.replace(/^\uFEFF/,'')));
  if(value.command)value.command=normalize(value.command);
  await writeFile(path,JSON.stringify(value,null,2)+'\n');
 }
}
console.log(JSON.stringify(result));
