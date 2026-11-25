import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const evidence=dirname(fileURLToPath(import.meta.url));
const scratch=mkdtempSync(join(tmpdir(),'gg-review524-correction-'));
const candidate='G:/ggq/gg-fu-qa-packets-20261124/GraphGoblin';
const cli=join(candidate,'tooling/scripts/check-qa-packet.mjs');
const config=readFileSync(join(candidate,'.prettierrc'));
const empty=join(scratch,'empty.gitconfig');
writeFileSync(empty,'');
const baseEnv={
  ...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^GIT_/i.test(name))),
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:empty,GIT_CEILING_DIRECTORIES:scratch,
  GIT_AUTHOR_NAME:'Review fixture',GIT_AUTHOR_EMAIL:'review@example.invalid',
  GIT_COMMITTER_NAME:'Review fixture',GIT_COMMITTER_EMAIL:'review@example.invalid',
};
const good='# QA packet\n\nEvidence summary.\n';
const bad='#  QA packet\n* changed\n';
const past=new Date('2020-01-01T00:00:00Z');
const sha=b=>createHash('sha256').update(b).digest('hex');
const results=[];
for(const variant of ['ordinary','alternate-index','split-index','sparse-index','autocrlf']) {
  const root=join(scratch,variant);
  mkdirSync(root);
  let env={...baseEnv};
  const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true});
  const write=(path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
  git('init','--quiet','--initial-branch=main');
  git('config','diff.autoRefreshIndex','true');
  if(variant==='autocrlf')git('config','core.autocrlf','true');
  write('.prettierrc',config);
  write('.prettierignore','docs/qa/visible/report-original.md\n');
  write('.gitignore','*.log\n');
  write('docs/qa/visible/clean.md',good);
  write('docs/qa/visible/report-original.md',bad);
  write('docs/qa/visible/real-change.md',good);
  write('docs/qa/visible/alternate-stage.md',good);
  write('docs/qa/hidden/retired.md',good);
  git('add','-A');git('commit','--quiet','-m','baseline');git('switch','--quiet','-c','feature');
  if(variant==='sparse-index') {
    write('docs/qa/hidden/new.md',good);git('rm','--quiet','docs/qa/hidden/retired.md');
    git('add','-A');git('commit','--quiet','-m','packet outside cone');
    git('sparse-checkout','set','--cone','--sparse-index','docs/qa/visible');
    assert.equal(existsSync(join(root,'docs/qa/hidden/new.md')),false);
  }
  if(variant==='alternate-index') {
    const alternate=join(root,'.git','review-alternate-index');
    copyFileSync(join(root,'.git/index'),alternate);
    env={...env,GIT_INDEX_FILE:alternate};
    write('docs/qa/visible/alternate-stage.md',bad);
    git('add','docs/qa/visible/alternate-stage.md');
    write('docs/qa/visible/alternate-stage.md',good);
  }
  if(variant==='split-index')git('update-index','--split-index');
  write('docs/qa/visible/real-change.md',bad);
  if(variant==='autocrlf')write('docs/qa/visible/clean.md',good.replaceAll('\n','\r\n'));
  for(const path of ['docs/qa/visible/clean.md','docs/qa/visible/report-original.md'])utimesSync(join(root,path),past,past);
  const gitDir=resolve(root,git('--no-optional-locks','rev-parse','--git-dir').trim());
  const activeIndexRaw=git('--no-optional-locks','rev-parse','--git-path','index').trim();
  const activeIndex=isAbsolute(activeIndexRaw)?activeIndexRaw:resolve(root,activeIndexRaw);
  const paths=[...new Set([
    join(gitDir,'index'),activeIndex,join(gitDir,'config'),
    ...readdirSync(gitDir).filter(p=>p.startsWith('sharedindex.')).map(p=>join(gitDir,p)),
    ...['clean.md','report-original.md','real-change.md','alternate-stage.md'].map(p=>join(root,'docs/qa/visible',p)),
  ])];
  const snapshot=()=>Object.fromEntries(paths.map(p=>[p,sha(readFileSync(p))]));
  const beforeModified=snapshot();
  const modified=git('--no-pager','--no-optional-locks','-c','diff.autoRefreshIndex=false','ls-files','--modified','-z','--','docs/qa').split('\0').filter(Boolean).sort();
  const afterModified=snapshot();
  assert.deepEqual(afterModified,beforeModified,variant+': ls-files wrote bytes');
  const expectedModified=['docs/qa/visible/real-change.md'];
  if(variant==='alternate-index')expectedModified.unshift('docs/qa/visible/alternate-stage.md');
  assert.deepEqual(modified,expectedModified,variant+': content selection');
  const beforeCli=snapshot();
  const r=spawnSync(process.execPath,[cli,'--base','main'],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:60000});
  const afterCli=snapshot();
  assert.deepEqual(afterCli,beforeCli,variant+': CLI wrote bytes');
  assert.equal(r.status,1,r.stdout+r.stderr);
  const listed=[...r.stdout.matchAll(/^ {2}(\S+) +(.+?)(?: {2}\[.*\])?$/gm)].map(([,kind,path])=>[kind,path]);
  const expected=[['UNFORMATTED','docs/qa/visible/real-change.md']];
  if(variant==='alternate-index')expected.unshift(['formatted','docs/qa/visible/alternate-stage.md']);
  if(variant==='sparse-index')expected.unshift(['UNAVAILABLE','docs/qa/hidden/new.md'],['deleted','docs/qa/hidden/retired.md']);
  assert.deepEqual(listed,expected,variant+': CLI selection');
  results.push({variant,root,activeIndex,modified,listed,beforeModified,afterModified,beforeCli,afterCli,status:r.status,stdout:r.stdout,stderr:r.stderr});
}
const report={node:process.version,git:execFileSync('git',['--version'],{encoding:'utf8'}).trim(),scratch,allPassed:true,results};
writeFileSync(join(evidence,'CORRECTION-CONTROLS.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({allPassed:true,variants:results.map(({variant,activeIndex,listed})=>({variant,activeIndex,listed}))},null,2));
