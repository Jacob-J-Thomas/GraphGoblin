const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const record=JSON.parse(fs.readFileSync('docs/qa/2026-10-22-web-test-stability/round2-after/tested-sources.json','utf8'));
const changed=record.files.filter(({file,sha256,gitBlob})=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==sha256||execFileSync('git',['hash-object','--path',file,file],{encoding:'utf8'}).trim()!==gitBlob).map(({file})=>file);
console.log(JSON.stringify({checked:record.files.length,changed}));process.exitCode=changed.length?1:0;
