import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const root=process.cwd();
const evidence=resolve('docs/qa/2026-10-25-wp-a2-241-qa/evidence');
const qa=resolve(evidence,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const display=p=>p.startsWith(root)?relative(root,p).replaceAll('\\','/'):p.replace(process.env.USERPROFILE,'%USERPROFILE%').replaceAll('\\','/');
async function walk(folder,prefix=''){
  const result=[];
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const path=join(folder,entry.name), rel=prefix+entry.name;
    if(entry.isDirectory()) result.push(...await walk(path,rel+'/'));
    else if(entry.isFile()){
      const bytes=await readFile(path);
      result.push({path:rel,size:bytes.length,sha256:sha(bytes)});
    }
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
const folders=[resolve('apps/web/test-results'),resolve('apps/web/playwright-report')];
try{
  const seed=JSON.parse(await readFile(resolve(evidence,'seed-manifest.json'),'utf8'));
  folders.push(seed.destination.replace('%USERPROFILE%',process.env.USERPROFILE));
  if(seed.outputFolder) folders.push(seed.outputFolder.replace('%USERPROFILE%',process.env.USERPROFILE));
  if(seed.htmlFolder) folders.push(seed.htmlFolder.replace('%USERPROFILE%',process.env.USERPROFILE));
  if(seed.controlOutputFolder) folders.push(seed.controlOutputFolder.replace('%USERPROFILE%',process.env.USERPROFILE));
  if(seed.controlHtmlFolder) folders.push(seed.controlHtmlFolder.replace('%USERPROFILE%',process.env.USERPROFILE));
}catch{}
const records=[];
for(const folder of [...new Set(folders)]){
  try{
    const files=await walk(folder);
    const canonical=files.map(f=>JSON.stringify(f)).join('\n')+'\n';
    records.push({path:display(folder),totalBytes:files.reduce((s,f)=>s+f.size,0),fileCount:files.length,canonicalManifestSha256:sha(Buffer.from(canonical)),files});
  }catch(error){if(error.code!=='ENOENT')throw error;}
}
await writeFile(join(evidence,'not-kept-files.json'),JSON.stringify(records,null,2)+'\n');
let markdown='# Not kept\n\nNo Playwright output folder, trace, screenshot or copied web build is included in the QA evidence. These generated folders remain at the locations below for the orchestrator to remove; QA did not delete directories. Individual files and SHA-256 values are recorded in [the inventory](evidence/not-kept-files.json).\n\nFolder SHA-256 means the SHA-256 of UTF-8 JSON lines for the sorted {path,size,sha256} records, with a trailing newline; it is not a filesystem directory hash.\n\n| Folder | Files | Bytes | Manifest SHA-256 |\n| --- | ---: | ---: | --- |\n';
for(const r of records) markdown+='| '+r.path+' | '+r.fileCount+' | '+r.totalBytes+' | '+r.canonicalManifestSha256+' |\n';
markdown+='\nCaptures larger than 1,000,000 bytes are included in that inventory, never copied into the report. Coverage output, build dist directories and Turbo caches are also generated locally; only coverage-summary.json is retained as QA evidence. No deletion is authorized or performed by this record.\n';
await writeFile(join(qa,'NOT-KEPT.md'),markdown);
const browserLog=await readFile(join(evidence,'edge-full.log.txt'),'utf8');
const routing=browserLog.split(/\r?\n/).filter(l=>l.includes('Routing performance: ')).map(l=>JSON.parse(l.slice(l.indexOf('Routing performance: ')+'Routing performance: '.length)));
await writeFile(join(evidence,'routing-performance.json'),JSON.stringify(routing,null,2)+'\n');
console.log(JSON.stringify(records.map(({files,...r})=>r),null,2));
