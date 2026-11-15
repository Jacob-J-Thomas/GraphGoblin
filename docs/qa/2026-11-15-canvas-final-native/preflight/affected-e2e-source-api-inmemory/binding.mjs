import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const output=path.dirname(fileURLToPath(import.meta.url));
const checkout="C:/Users/98jak/.codex/worktrees/gg-20261114-canvas/GraphGoblin";
const prior="C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/review-207/corrected-doubleclick-native-dbc55454b224";
const rec=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=file=>sha(fs.readFileSync(file));
const phase=process.argv[2];
assert(['before','after'].includes(phase));
const write=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const old=rec(prior+'/binding-before.json');
const s=rec(prior+'/source-closure-before.json');
const git=(...args)=>execFileSync('git',args,{cwd:checkout,maxBuffer:128*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).toString().trim();
const sourceWorktree={head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),base:git('rev-parse','origin/main'),
 status:git('status','--porcelain=v1','--untracked-files=all'),indexSha256:hash(path.resolve(checkout,git('rev-parse','--git-path','index')))};
assert.equal(sourceWorktree.head,'dbc55454b224e350f7005cdaf58b8655c4b9e71e');
assert.deepEqual([sourceWorktree.head,sourceWorktree.tree,sourceWorktree.base,sourceWorktree.status],[old.head,old.tree,old.actualMain,'']);
const source={};
for(const [name,expected] of Object.entries(s.sources)){
 const file=path.join(checkout,name);
 const bytes=fs.readFileSync(file);
 const digest=sha(bytes);
 assert.equal(digest,expected.sha256,name);
 assert.equal(bytes.length,expected.bytes,name);
 if(expected.gitBlob)assert.equal(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),expected.gitBlob,name);
 source[name]=digest;
}
function inventory(dir){
 const entries=fs.readdirSync(dir,{recursive:true,withFileTypes:true});
 assert(!entries.some(e=>e.isSymbolicLink()),dir);
 return Object.fromEntries(entries.filter(e=>e.isFile()).map(row=>path.relative(dir,path.join(row.parentPath,row.name)).replaceAll('\\','/')).sort().map(name=>[name,hash(path.join(dir,name))]));
}
const artifacts={};
for(const [tree,files] of Object.entries(old.artifacts)){
 artifacts[tree]=inventory(path.join(checkout,tree));
 assert.deepEqual(artifacts[tree],files,tree);
}
const report={sourceWorktree,node:process.version,source,artifacts,expectedBindingSha256:hash(prior+'/binding-before.json'),
 observedSourceManifestSha256:hash(prior+'/source-closure-before.json')};
if(phase==='after')assert.deepEqual(report,rec(output+'/binding-before.json'));
const originalDist=path.join(checkout,'apps','web','dist');
const copiedDist=path.join(output,'web-dist');
assert.notEqual(fs.realpathSync(originalDist),path.resolve(copiedDist));
if(phase==='before'){
 assert(!fs.existsSync(copiedDist));
 fs.cpSync(originalDist,copiedDist,{recursive:true,errorOnExist:true,force:false});
}
const copiedFiles=inventory(copiedDist);
const changed=[...new Set([...Object.keys(copiedFiles),...Object.keys(artifacts['apps/web/dist'])])].filter(name=>copiedFiles[name]!==artifacts['apps/web/dist'][name]);
if(phase==='before')assert.equal(changed.length,0,'Disposable build copy must be exact before use');
write('binding-'+phase+'.json',report);
write('dist-copy-'+phase+'.json',{originalDist,copiedDist,copyFiles:copiedFiles,changed,copySwMtime:fs.statSync(path.join(copiedDist,'sw.js')).mtime.toISOString(),
 originalSwMtime:fs.statSync(path.join(originalDist,'sw.js')).mtime.toISOString()});
console.log(JSON.stringify({phase,head:sourceWorktree.head,tree:sourceWorktree.tree,sources:Object.keys(source).length,
 artifactTrees:Object.keys(artifacts).length,buildFiles:Object.values(artifacts).reduce((sum,tree)=>sum+Object.keys(tree).length,0),
 copiedItems:Object.keys(copiedFiles).length,copyChanges:changed}));
