// Fresh independent re-check; old evidence stays unchanged.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import{fileURLToPath}from'node:url';
const out=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const original=path.resolve(out,'..');const root=path.resolve(out,'../../../..');
for(const name of ['lib.mjs','qa.mjs','build-baseline.mjs','baseline-loader.mjs','fake-cli.cs.txt','settings-inherited.mjs']){
 let text=fs.readFileSync(path.join(original,'scripts',name),'utf8').replaceAll('gg-qa205-','gg-qa205b-');
 if(name==='lib.mjs')text=text.replace("path.resolve(OUT, '..', '..', '..')","path.resolve(OUT, '..', '..', '..', '..')");
 if(name==='baseline-loader.mjs')text=text.replace("path.resolve(record,'../../..')","path.resolve(record,'../../../..')");
 fs.writeFileSync(path.join(out,'scripts',name),text);
}
const tools=fs.mkdtempSync(path.join(os.tmpdir(),'gg-qa205b-tools-'));fs.mkdirSync(path.join(tools,'fake'));
fs.copyFileSync(path.join(out,'scripts/fake-cli.cs.txt'),path.join(tools,'fake-cli.cs'));
const main=fs.mkdtempSync(path.join(os.tmpdir(),'gg-qa205b-main-src-'));
fs.writeFileSync(path.join(os.tmpdir(),'gg-qa205b-state.json'),JSON.stringify({tools,main}));
console.log('Prepared re-check helper copies, fresh state and fake CLI source.');
