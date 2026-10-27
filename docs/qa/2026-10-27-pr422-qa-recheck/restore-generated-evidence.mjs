// Undo only the maintained missing-session driver's eight generated QA captures.
// The initial worktree was clean. Preserve this run's output here before restoring HEAD.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as L from './lib.mjs';
const files=['claude','codex'].flatMap(family=>['resume-own','resume-previous'].flatMap(policy=>[
  `docs/qa/2026-10-24-wp-f4-265/restart-calls-${family}-${policy}.jsonl`,
  `docs/qa/2026-10-24-wp-f4-265/restart-events-${family}-${policy}.json`,
]));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const results=[];
for(const file of files){
  const original=spawnSync('git',['show','HEAD:'+file],{cwd:L.REPO});
  if(original.status!==0)throw Error(String(original.stderr));
  const current=fs.readFileSync(path.join(L.REPO,file));
  L.save('maintained-'+path.basename(file),current.toString('utf8'));
  fs.writeFileSync(path.join(L.REPO,file),original.stdout);
  results.push({file,generatedBytes:current.length,generatedSha256:sha(current),headBlobSha256:sha(original.stdout),restoredSha256:sha(fs.readFileSync(path.join(L.REPO,file)))});
}
L.save('side-effect-restoration.json',{initialWorktree:'clean',reason:'Maintained integration driver writes a fixed historical QA destination',results});
console.log('Preserved eight generated captures locally; restored all eight to HEAD blob bytes.');
