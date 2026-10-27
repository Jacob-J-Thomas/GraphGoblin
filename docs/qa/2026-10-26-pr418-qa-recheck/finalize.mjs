// Record hygiene only. Reads our own retained temp stores; writes only this QA folder.
// Does not delete files/directories or terminate processes.
import {readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';
import {join,relative,isAbsolute} from 'node:path';import {tmpdir} from 'node:os';
import {HERE} from './lib.mjs';
const profile=process.env.USERPROFILE,machine=process.env.COMPUTERNAME;
const redact=s=>{
  for(const p of [profile,profile?.replaceAll('\\','\\\\'),profile?.replaceAll('\\','/')])if(p)s=s.replaceAll(p,'%USERPROFILE%');
  if(machine)s=s.replaceAll(machine,'%COMPUTERNAME%');
  return s.replace(/S-1-\d+(?:-\d+)+/g,'<SID>');
};
const entries=(await readFile(join(HERE,'processes.log.txt'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));
const dirs=[...new Set(entries.map(e=>e.dataDir.replaceAll('%USERPROFILE%',profile)))];
const stores=[],omitted=[];
for(const dir of dirs){
  const rel=relative(tmpdir(),dir);
  if(isAbsolute(rel)||rel.includes('..')||!rel.startsWith('gg-qa-418r-'))throw new Error('Not an owned store');
  const files=[];
  for(const item of await readdir(dir,{withFileTypes:true})){
    if(!item.isFile())continue;const path=join(dir,item.name),size=(await stat(path)).size;
    if(size<=1_000_000)continue;
    const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
    const row={name:rel+'/'+item.name,size,sha256:hash.digest('hex')};files.push(row);omitted.push(row);
  }
  stores.push({directory:redact(dir),filesAboveLimit:files});
}
await writeFile(join(HERE,'retained-stores.json'),JSON.stringify(stores,null,2)+'\n');
const lines=['# Not kept in the QA record','',
'No capture in this folder exceeds 1,000,000 bytes. Large SSE bodies were parsed in memory and only their counts, controls and recovery results were saved; no raw SSE capture file was created.',
'','The following disposable database files remain in the system temp directory and are deliberately excluded from this record. No directory was deleted. Sizes and SHA-256 values describe the retained bytes at final inspection. Small store/key files also remain outside the record and are not copied.','',
'| Temp-relative file | Bytes | SHA-256 |','| --- | ---: | --- |',
...omitted.map(x=>`| \`${x.name}\` | ${x.size} | \`${x.sha256}\` |`),''];
await writeFile(join(HERE,'NOT-KEPT.md'),lines.join('\n'));
for(const name of await readdir(HERE)){
  if(!/\.(?:md|mjs|ps1|json|txt)$/.test(name))continue;
  const path=join(HERE,name);await writeFile(path,redact(await readFile(path,'utf8')));
}
console.log(JSON.stringify({stores:stores.length,largeTempFilesNotCopied:omitted.length,redacted:true}));
