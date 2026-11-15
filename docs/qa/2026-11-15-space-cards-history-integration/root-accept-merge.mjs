import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = 'C:/Users/98jak/.codex/worktrees/gg-20261114-space-cards/GraphGoblin';
const evidence = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-208-final-integration';
const git = (...args) => execFileSync('git',['-C',root,...args],{maxBuffer:20*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).toString().trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (git('rev-parse','HEAD') !== '608864748e84fd0a7d4ae9d04495da92d509f721' || git('rev-parse','MERGE_HEAD') !== '6b0eae62ea98ae73b22903c9922bba198e219608') throw new Error('Ancestry changed');
const index = git('rev-parse','--git-path','index');
if (hash(readFileSync(index)) !== '60115447fa12298889536021e14a7fd710f92cc25a150239047f8a535ff8b150') throw new Error('Worker changed index');
const hashes = {
 'apps/web/src/editor/Canvas.tsx':'fbb3cb1c331c12b74212b2492b229540d534bfbb3b912da016124019566b0bf3',
 'apps/web/src/editor/store.ts':'a228d1b51a68d3d9a63c7d4263b94c97aa9a4790fb5f5d101be3ee4d290ff596',
 'docs/09-frontend-and-pwa.md':'147472b2fcd502be40227cb8639b64b0553a47439751ab979c31aad46ccfc01f',
 'docs/guide/02-build-a-loop.md':'ad21a62db6e11dce2c99719d9f59900c94dc6ee17f4b1572facb2cb31a5b5dd2'
};
for (const [path, expected] of Object.entries(hashes)) {
 const bytes=readFileSync(join(root,path));
 if(hash(bytes)!==expected || /^(?:<<<<<<<|=======|>>>>>>>)/m.test(bytes.toString())) throw new Error(`Unaccepted content: ${path}`);
}
let checked=0;
for(const line of readFileSync(join(evidence,'SHA256SUMS.txt'),'utf8').trim().split(/\r?\n/)) {
 const m=/^([0-9a-f]{64}) \*(.+)$/.exec(line);
 if(!m || hash(readFileSync(join(evidence,m[2])))!==m[1]) throw new Error(`Evidence changed: ${line}`);
 checked++;
}
const attr='docs/qa/.gitattributes',before=readFileSync(join(root,attr));
if(hash(before)!=='87b0333a1b5ff9e55dc9cf81253a7190f77fea591aa21c9308cacb7957da71c9') throw new Error('Attribute conflict changed');
const unmerged=[...new Set(git('diff','--name-only','--diff-filter=U').split('\n'))].sort();
if(JSON.stringify(unmerged)!==JSON.stringify([...Object.keys(hashes),attr].sort())) throw new Error('Unexpected unresolved paths');
const lines=before.toString().split('\n');
const markers=lines.filter(l=>/^(?:<<<<<<< |=======$|>>>>>>> )/.test(l));
if(markers.length!==3) throw new Error('Unexpected markers');
writeFileSync(join(root,attr),lines.filter(l=>!/^(?:<<<<<<< |=======$|>>>>>>> )/.test(l)).join('\n'));
git('add','--',...Object.keys(hashes),attr);
if(git('diff','--name-only','--diff-filter=U') || git('diff','--name-only')) throw new Error('Unresolved or unstaged tracked edits');
const productDelta=git('diff','--cached','--name-only','MERGE_HEAD','--',':(exclude)docs/qa/**',':(exclude)docs/delivery/**').split('\n').filter(Boolean);
const result={at:new Date().toISOString(),head:git('rev-parse','HEAD'),mergeHead:git('rev-parse','MERGE_HEAD'),stagedTree:git('write-tree'),workerIndexUnchanged:true,workerArtifactsVerified:checked,acceptedHashes:hashes,attributeSha256:hash(readFileSync(join(root,attr))),productDelta};
writeFileSync(join(evidence,'root-acceptance.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
