import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const evidence=dirname(fileURLToPath(import.meta.url));
const scratch=mkdtempSync(join(tmpdir(),'gg-review524-crlf-'));
const root=join(scratch,'repository');mkdirSync(root);
const empty=join(scratch,'empty.gitconfig');writeFileSync(empty,'');
const env={...Object.fromEntries(Object.entries(process.env).filter(([n])=>!/^GIT_/i.test(n))),
 GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:empty,GIT_CEILING_DIRECTORIES:scratch,
 GIT_AUTHOR_NAME:'Review fixture',GIT_AUTHOR_EMAIL:'review@example.invalid',
 GIT_COMMITTER_NAME:'Review fixture',GIT_COMMITTER_EMAIL:'review@example.invalid'};
const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true});
const good='# QA packet\n\nEvidence summary.\n';
const path='docs/qa/historical/README.md';
const absolute=join(root,path);const index=join(root,'.git/index');
const hash=b=>createHash('sha256').update(b).digest('hex');
git('init','--quiet','--initial-branch=main');
git('config','core.autocrlf','true');
writeFileSync(join(root,'.gitattributes'),'* text=auto eol=lf\n');
writeFileSync(join(root,'.prettierrc'),readFileSync('G:/ggq/gg-fu-qa-packets-20261124/GraphGoblin/.prettierrc'));
mkdirSync(dirname(absolute),{recursive:true});writeFileSync(absolute,good);
git('add','-A');git('commit','--quiet','-m','baseline');git('switch','--quiet','-c','feature');
writeFileSync(absolute,good.replaceAll('\n','\r\n'));utimesSync(absolute,new Date('2020-01-01T00:00:00Z'),new Date('2020-01-01T00:00:00Z'));
const before=readFileSync(index);writeFileSync(join(evidence,'AUTOCRLF-index-before.bin'),before);
const normalized=git('hash-object','--path',path,absolute).trim();
const indexBlob=git('rev-parse',`HEAD:${path}`).trim();
const noRefresh=git('--no-optional-locks','-c','diff.autoRefreshIndex=false','diff','--name-status','--',path);
const modified=git('--no-optional-locks','-c','diff.autoRefreshIndex=false','ls-files','--modified','-z','--',path).split('\0').filter(Boolean);
const cli=spawnSync(process.execPath,['G:/ggq/gg-fu-qa-packets-20261124/GraphGoblin/tooling/scripts/check-qa-packet.mjs','--base','main'],{cwd:root,env,encoding:'utf8',windowsHide:true});
const after=readFileSync(index);writeFileSync(join(evidence,'AUTOCRLF-index-after.bin'),after);
// Baseline diff runs last because it refreshes this disposable index; it is not used in read-only assertions.
const normal=git('--no-optional-locks','-c','diff.autoRefreshIndex=true','diff','--name-status','--',path);
const report={root,node:process.version,git:git('--version').trim(),attributes:'* text=auto eol=lf',normalized,indexBlob,gitContentEqual:normalized===indexBlob,indexUnchangedDuringCorrectedCli:before.equals(after),before:hash(before),after:hash(after),noRefresh,modified,normalRefresh:normal,cli:{status:cli.status,stdout:cli.stdout,stderr:cli.stderr}};
writeFileSync(join(evidence,'AUTOCRLF-CONFIRMED.json'),JSON.stringify(report,null,2)+'\n');
assert.equal(normalized,indexBlob);assert.ok(before.equals(after));assert.equal(normal,'');
assert.equal(cli.status,1);assert.match(cli.stdout,/UNFORMATTED +docs\/qa\/historical\/README\.md/);
console.log(JSON.stringify(report,null,2));
