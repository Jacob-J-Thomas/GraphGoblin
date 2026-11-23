from pathlib import Path
import subprocess,os,shutil,hashlib,json,datetime
q=Path(__file__).resolve().parent;out=q/'i4-486-windows-controls-01';out.mkdir(exist_ok=False)
candidate=Path('G:/ggq/gg-i4-486-authored-errors/GraphGoblin');base=Path('G:/ggq/gg-i4-486-qa/GraphGoblin')
scratch=Path('C:/Users/98jak/AppData/Local/Temp/gg486-controls-01');scratch.mkdir(exist_ok=False)
runtime=Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')
env={**os.environ,'PATH':str(runtime)+os.pathsep+os.environ['PATH'],'TEMP':str(scratch),'TMP':str(scratch),'GIT_OPTIONAL_LOCKS':'0'}
pnpm=shutil.which('pnpm.cmd',path=env['PATH']);assert subprocess.check_output([str(runtime/'node.exe'),'--version'],env=env,text=True).strip()=='v22.23.4'
assert env.get('LIVE')!='1' and env.get('LIVE_CLAUDE')!='1'
def git(repo,*args):return subprocess.check_output(['git',*args],cwd=repo,env=env)
assert git(base,'rev-parse','HEAD').decode().strip()=='02351e2fb932b3be44e7cc3fb3943a61d568226c'
assert not git(base,'status','--porcelain')
files=['src/fs/chat-audio.test.ts','src/process/voice.test.ts','src/sqlite/catalog.test.ts','src/sqlite/chat.test.ts']
bindings=[]
for f in files:
 p='packages/infrastructure/'+f;a=(candidate/p).read_bytes();b=(base/p).read_bytes();assert a.replace(b'\r\n',b'\n')==b.replace(b'\r\n',b'\n'),p
 bindings.append({'path':p,'candidateSha256':hashlib.sha256(a).hexdigest(),'baseSha256':hashlib.sha256(b).hexdigest(),'equalAfterLineEndingNormalization':True})
(out/'source-binding.json').write_text(json.dumps(bindings,indent=2)+'\n')
records=[]
commands=[('base-four-files',base,[pnpm,'--filter','@graphgoblin/infrastructure','exec','vitest','run',*files,'--reporter=verbose'])]+[(s,candidate,[pnpm,s]) for s in ['check:templates','check:licenses','check:docs','check:contrast']]+[('audit',candidate,[pnpm,'audit','--audit-level=high'])]
for name,repo,args in commands:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (out/(name+'.log')).open('wb') as log:p=subprocess.run(args,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
 rec={'command':args,'cwd':str(repo),'started':start,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode,'log':name+'.log','runtime':'v22.23.4','TEMP':str(scratch)}
 records.append(rec);(out/'commands.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(rec),flush=True)
 if name!='base-four-files' and p.returncode:raise SystemExit(p.returncode)
assert not git(base,'status','--porcelain')
expected=json.loads((q/'i4-486-combined-gates-01/after-check.json').read_bytes())
for x in expected:assert hashlib.sha256((candidate/x['path']).read_bytes()).hexdigest()==x['sha256'],x['path']
(out/'result.json').write_text(json.dumps({'candidate52SourceHashesUnchanged':True,'baseClean':True,'allCommands':records,'scope':'Base control of the four failing Windows files plus previously unreached checks. Not a passing full coverage gate.'},indent=2)+'\n')
