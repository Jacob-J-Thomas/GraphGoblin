import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const qa=resolve('docs/qa/2026-10-25-wp-a2-241-qa'), evidence=join(qa,'evidence');
const read=path=>readFile(path,'utf8');
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(head!=='3ffb23affa0148ce3eeccc7869f69b6da8dbaebb')throw new Error('HEAD changed');
const changed=execFileSync('git',['diff','--name-only','--','.',':!docs/qa'],{encoding:'utf8'}).trim();
if(changed)throw new Error('Non-QA tracked files changed: '+changed);
const staged=execFileSync('git',['diff','--cached','--name-only'],{encoding:'utf8'}).trim();
if(staged)throw new Error('Index is no longer empty: '+staged);
async function walk(folder){
 const files=[];
 for(const entry of await readdir(folder,{withFileTypes:true})){
  if(entry.isDirectory())files.push(...await walk(join(folder,entry.name)));
  else if(entry.isFile())files.push(join(folder,entry.name));
 }
 return files.sort();
}
const files=await walk(qa), report=await read(join(qa,'README.md')), results=[];
for(const file of files){
 const rel=relative(qa,file).replaceAll('\\','/');
 if(rel==='evidence/retained-sha256.json')continue;
 if(rel!=='README.md'&&!report.includes(']('+rel+')'))throw new Error('README does not directly link '+rel);
 const bytes=await readFile(file);
 if(bytes.length>1000000)throw new Error('Oversized retained artifact '+rel);
 const content=bytes.toString('utf8'), profile=process.env.USERPROFILE;
 if(content.includes(profile)||content.includes(profile.replaceAll('\\','/'))||content.includes(JSON.stringify(profile).slice(1,-1)))throw new Error('Unnormalized user path in '+rel);
 results.push({path:rel,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(join(evidence,'retained-sha256.json'),JSON.stringify({head,algorithm:'SHA-256 of exact final retained bytes; manifest itself excluded',files:results},null,2)+'\n');
console.log(JSON.stringify({head,nonQaTrackedChanges:changed,stagedChanges:staged,linkedFiles:results.length,retentionAndPathChecks:'passed'}));
