const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=process.cwd(),qa='docs/qa/2026-10-22-web-test-stability';
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).trim();
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk(qa),leaks=files.filter(file=>{const bytes=fs.readFileSync(file);return ['utf8','utf16le'].some(encoding=>bytes.includes(Buffer.from(process.env.USERNAME,encoding)));});
const failures=[];
for(const name of ['evidence-provenance.json','round2-evidence-provenance.json'])for(const entry of JSON.parse(fs.readFileSync(path.join(qa,name),'utf8')))if(sha(path.join(qa,entry.name))!==entry.retainedSha256)failures.push(entry.name);
const untracked=git('ls-files','--others','--exclude-standard').split(/\r?\n/).filter(Boolean);
let ignored=[];
try {ignored=cp.execFileSync('git',['check-ignore','--no-index','--stdin'],{input:files.join('\n')+'\n',encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);}catch(error){if(error.status!==1)throw error;}
const changed=git('diff','--name-only').split(/\r?\n/).filter(Boolean),staged=git('diff','--cached','--name-only');
const appChanges=changed.filter(file=>file.startsWith('apps/'));
const unexpected=appChanges.filter(file=>!['apps/web/src/editor/EditorPage.test.tsx','apps/web/src/forms/cron/control.test.tsx','apps/web/src/settings/sections/ClassifierModelsSection.test.tsx'].includes(file));
const result={head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),changed,untrackedCount:untracked.length,untrackedOutsideEvidence:untracked.filter(file=>!file.startsWith(qa+'/')),staged,artifactCount:files.length,localUsernameLeaks:leaks,manifestHashMismatches:failures,ignoredEvidence:ignored,unexpectedAppChanges:unexpected};
console.log(JSON.stringify(result,null,2));
if(leaks.length||failures.length||ignored.length||unexpected.length||staged||result.untrackedOutsideEvidence.length||result.head!=='67c8408839d6990f4739257e036e0483a5e0d7d2'||result.branch!=='codex-chore-web-test-stability')process.exitCode=1;
