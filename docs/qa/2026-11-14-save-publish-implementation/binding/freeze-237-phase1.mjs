import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
const batch='C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const root='C:/Users/98jak/.codex/worktrees/gg-20261114-save-publish/GraphGoblin';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const hash=b=>createHash('sha256').update(b).digest('hex');
const parent='700ce251bc4c3b7ad29e072d0764ad9a5ca9174e';
assert.equal(git('rev-parse','HEAD'),parent);
assert.equal(git('diff','--cached','--name-only'),'');
const manifest=readFileSync(batch+'/ui-237-claude-implementation/evidence/candidate/source-manifest-1.txt','utf8');
const sources={};
for(const row of manifest.split(/\r?\n/)){
 const m=/^([a-f0-9]{64})  (.+)$/.exec(row);if(!m)continue;
 assert.equal(hash(readFileSync(join(root,m[2]))),m[1],m[2]);sources[m[2]]={sha256:m[1],gitBlob:git('hash-object',m[2])};
}
assert.equal(Object.keys(sources).length,16);
const tracked=git('diff','--name-only').split('\n');
const added=git('ls-files','--others','--exclude-standard').split('\n');
assert.equal(tracked.length,12);assert.equal(added.length,4);
assert.deepEqual([...tracked,...added].sort(),Object.keys(sources).sort());git('diff','--check');
const sourceDiff=execFileSync('git',['diff','HEAD'],{cwd:root});
assert.equal(hash(sourceDiff),'0927a70ffa69cb664108b66e3cb6e0cadc312c95db24fbee2c26b6e1e61f6b15');
const buildManifest=readFileSync(batch+'/ui-237-claude-implementation/evidence/candidate/attempt1/build-manifest.txt');
const builds=new Map();
for(const row of buildManifest.toString('utf8').split(/\r?\n/)){
 if(!row.trim())continue;const m=/^(.+) ([a-f0-9]{64})$/.exec(row);assert(m,row);builds.set(m[1],m[2]);
}
const gateway=JSON.parse(readFileSync(batch+'/ui-237-claude-implementation/evidence/candidate/attempt1/gateway.json','utf8'));
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>{assert(!e.isSymbolicLink());return e.isDirectory()?walk(join(d,e.name)):[join(d,e.name)];});
let count=0;for(const [dir,n] of Object.entries(gateway.build.perRoot)){
 const files=walk(join(root,dir));assert.equal(files.length,n,dir);
 for(const f of files){const rel=relative(root,f).replaceAll('\\','/');assert.equal(hash(readFileSync(f)),builds.get(rel),rel);count++;}
}
assert.equal(count,1117);assert.equal(builds.size,count);
const out={observedAt:new Date().toISOString(),parent,tree:git('rev-parse','HEAD^{tree}'),tracked,added,sources,trackedDiffSha256:hash(sourceDiff),buildFiles:count,buildManifestSha256:hash(buildManifest),nativeGatewayBuildDigest:gateway.build.digest,sourceStatus:'Implementation phase1 candidate only; independent QA and parent209 correction integration pending',pendingDiagnostic:'Unknown retry awaits readBack then may POST without rechecking held input or editor generation. Source hypothesis only; public native barrier reproduction pending.',model:'claude-opus-5-5',requestedEffort:'xhigh',checks:'866 focused;2529 wholeweb98.52lines94.03branches;38 Edge;17 implementation-native observational scenarios, not independent acceptance'};
writeFileSync(batch+'/ui-237-phase1-precommit-binding.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({readyForRootCommit:true,sources:Object.keys(sources).length,buildFiles:count,trackedDiffSha256:out.trackedDiffSha256}));
