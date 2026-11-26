import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'gg-review524-'));
const root = join(scratch, 'qa repository');
mkdirSync(root);
const emptyConfig = join(scratch, 'empty.gitconfig');
writeFileSync(emptyConfig, '');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig,
  GIT_CEILING_DIRECTORIES: scratch,
  GIT_AUTHOR_NAME: 'QA fixture', GIT_AUTHOR_EMAIL: 'qa-fixture@example.invalid',
  GIT_COMMITTER_NAME: 'QA fixture', GIT_COMMITTER_EMAIL: 'qa-fixture@example.invalid',
  GIT_TRACE2_EVENT: join(evidence, 'readonly-repro-git-trace.jsonl'),
};
const git = (...args) => execFileSync('git', args, {cwd: root, env, encoding: 'utf8', windowsHide: true});
const write = (path, content) => { mkdirSync(dirname(join(root,path)), {recursive: true}); writeFileSync(join(root,path), content); };
const good = '# QA packet\n\nEvidence summary.\n';
git('init','--quiet','--initial-branch=main');
write('.prettierrc','{"semi":true,"singleQuote":true,"trailingComma":"all","printWidth":100,"tabWidth":2}\n');
write('.prettierignore','docs/qa/**/*.json\ndocs/qa/archive-packet/**\n');
write('.gitignore','*.log\n');
write('README.md',good);
write('docs/qa/2026-11-01-historical/README.md',good);
write('docs/qa/archive-packet/author/report-original.md','#  Raw\n* old\n');
write('docs/qa/p/edited.md',good);
write('docs/qa/p/recreated.md',good);
write('docs/qa/p/staged-then-edited.md',good);
git('add','-A'); git('commit','--quiet','-m','historical evidence'); git('switch','--quiet','-c','feature');
write('docs/qa/p/committed-then-edited.md',good);
git('add','-A'); git('commit','--quiet','-m','first pass');
write('docs/qa/p/committed-then-edited.md',good+'\nSecond pass.\n');
write('docs/qa/p/staged-then-edited.md',good+'\nSecond pass.\n');
git('add','docs/qa/p/staged-then-edited.md');
write('docs/qa/p/staged-then-edited.md',good+'\nSecond pass.\n\nThird pass.\n');
write('docs/qa/p/edited.md',good+'\nSecond pass.\n');
write('docs/qa/p/staged.md',good); git('add','docs/qa/p/staged.md');
git('rm','--cached','--quiet','docs/qa/p/recreated.md');
write('docs/qa/p/untracked.md',good); write('docs/qa/p/session.log','ignored\n');
write('docs/qa/2026-11-01-historical/README.md',good);
const indexPath = join(root,'.git/index');
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const observations = [];
function snapshot(label, action) {
  const before = readFileSync(indexPath);
  const result = action();
  const after = readFileSync(indexPath);
  writeFileSync(join(evidence,`${label}-index-before.bin`),before);
  writeFileSync(join(evidence,`${label}-index-after.bin`),after);
  observations.push({label,before:hash(before),after:hash(after),changed:!before.equals(after),result});
}
snapshot('01-entire-cli', () => {
  const r=spawnSync(process.execPath,['G:/ggq/gg-fu-qa-packets-20261124/GraphGoblin/tooling/scripts/check-qa-packet.mjs','--base','main'],{cwd:root,env,encoding:'utf8',windowsHide:true});
  return {status:r.status,stdout:r.stdout,stderr:r.stderr};
});
// Re-stale the clean tracked historical page, then run each Git command from the CLI separately.
write('docs/qa/2026-11-01-historical/README.md',good);
const cliGit = (...args) => git('--no-pager','--no-optional-locks',...args);
snapshot('02-toplevel',()=>cliGit('rev-parse','--show-toplevel'));
snapshot('03-base',()=>cliGit('rev-parse','--verify','--quiet','main^{commit}'));
const mergeBase=cliGit('merge-base','main','HEAD').trim();
snapshot('04-merge-base',()=>cliGit('merge-base','main','HEAD'));
snapshot('05-staged',()=>cliGit('diff','--name-status','-z','--no-renames','--no-color','--cached',mergeBase,'--','docs/qa'));
snapshot('06-unstaged',()=>cliGit('diff','--name-status','-z','--no-renames','--no-color','--','docs/qa'));
snapshot('07-untracked',()=>cliGit('ls-files','--others','--exclude-standard','-z','--','docs/qa'));
const report={root,node:process.version,gitVersion:git('--version').trim(),observations};
writeFileSync(join(evidence,'readonly-repro-result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
