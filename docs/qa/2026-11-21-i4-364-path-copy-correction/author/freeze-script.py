from pathlib import Path
import subprocess,json,hashlib,os,datetime
repo=Path('G:/ggq/gg-i4-364-claude-start/GraphGoblin');out=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-364-path-copy-author-01');file='docs/guide/07-troubleshooting.md'
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*a):return subprocess.check_output(['git',*a],cwd=repo)
parent=git('rev-parse','HEAD').decode().strip();assert parent=='c9d23dd1a996cde40d285c1ce103b8c8291cb3ab'
assert git('diff','--name-only').decode().splitlines()==[file] and not git('diff','--cached')
before=(out/'before.md').read_bytes();after=(repo/file).read_bytes();expected=before.replace(bytes([8])+b'in',b'\\bin',1)
a=expected.decode().splitlines();b=after.decode().splitlines();assert len(a)==len(b)
padding=[]
for n,(x,y) in enumerate(zip(a,b),1):
 if x!=y:
  assert x.startswith('|') and y.startswith('|') and [c.strip()for c in x.split('|')]==[c.strip()for c in y.split('|')]
  padding.append(n)
assert padding==[168]
assert not [(i,c)for i,c in enumerate(after)if c<32 and c not in(9,10,13)]
(out/'after.md').write_bytes(after);(out/'patch.diff').write_bytes(git('diff','--',file));(out/'harness-default-source.txt').write_bytes(git('show',parent+':packages/infrastructure/src/claude/harness.ts'))
env={**os.environ,'PATH':'C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64;'+os.environ['PATH']}
args=['cmd.exe','/d','/c','pnpm.cmd','exec','prettier','--check',file];p=subprocess.run(args,cwd=repo,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
(out/'format.stdout').write_bytes(p.stdout);(out/'format.stderr').write_bytes(p.stderr);assert p.returncode==0
(out/'format.receipt.json').write_text(json.dumps({'argv':args,'cwd':str(repo),'exit':p.returncode,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()},indent=2)+'\n')
git('diff','--check');git('add','--',file);(out/'commit.stdout').write_bytes(git('commit','-m','docs: restore literal Claude executable path in troubleshooting'))
head=git('rev-parse','HEAD').decode().strip();assert not git('status','--porcelain')
assert git('diff','--name-only',parent,head).decode().splitlines()==[file] and git('show',head+':'+file)==after
receipt={'head':head,'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'parent':parent,'file':file,'beforeSha256':sha(before),'afterSha256':sha(after),'change':'one ASCII backspace replaced with literal backslash and b; formatter table padding on the same row','onlyPathChanged':True,'runtimeAndFrozenD203FiveFilesUnchanged':True,'clean':True,'formatPaddingLines':padding}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
report="""# #364 documentation path copy correction

Root found one ASCII BACKSPACE byte in the Claude executable default path in docs/guide/07-troubleshooting.md line 168 while preparing integration. It made the displayed/copied path differ from the actual ClaudeHarness default. The correction replaces that byte with the literal backslash and b. Prettier adjusts the same table row's trailing cell padding; every other line and every other cell value remains exact. The code span now reads %USERPROFILE%\\.local\\bin\\claude.exe, matching harness.ts constructor components.

Scoped Prettier and git diff checks passed. The only committed path is this guide. No runtime, test, dependency, schema, stored data, old archive, prior report or D203 five-file source changed. No unit/browser/provider suite was rerun for this documentation repair. Original before/after bytes, patch, constructor source, format output and commit receipt are retained.

An initial root verification expected byte equality after only replacing the control byte and failed because Prettier removed one table-padding space on the same row. Before staging or commit, a subsequent diagnostic byte-level SequenceMatcher was stopped via its own session after it was unnecessarily slow on padded tables (exit1, no output); no product process was affected. The final check compares every line exactly, allowing only edge padding in the one repaired table row while requiring every cell's content to match the precise replacement. No product acceptance assertion was changed.

This is author evidence, not independent review or QA. All three general scans remain consumed. D206 requires bounded opposite-family corrective review and a separate independent path/byte check, followed by ordinary final current-target gates and D035/D042 coordinator completion.
"""
(out/'REPORT.md').write_text(report,encoding='utf8');(out/'freeze-script.py').write_bytes(Path(__file__).read_bytes())
(out/'SHA256SUMS.json').write_text(json.dumps([{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}for p in sorted(out.iterdir())],indent=2)+'\n')
print(json.dumps(receipt))

