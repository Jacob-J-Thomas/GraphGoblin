from pathlib import Path
import subprocess,os,shutil,hashlib,json,datetime
q=Path(__file__).resolve().parent
repo=Path('G:/ggq/gg-i4-486-authored-errors/GraphGoblin')
out=q/'i4-486-serial-gates-01';out.mkdir(exist_ok=False)
scratch=Path('C:/Users/98jak/AppData/Local/Temp/gg486-serial-01');scratch.mkdir(exist_ok=False)
runtime=Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')
env={**os.environ,'PATH':str(runtime)+os.pathsep+os.environ['PATH'],'TEMP':str(scratch),'TMP':str(scratch)}
assert env.get('LIVE')!='1' and env.get('LIVE_CLAUDE')!='1'
node=shutil.which('node.exe',path=env['PATH']);pnpm=shutil.which('pnpm.cmd',path=env['PATH'])
assert Path(node).resolve()==(runtime/'node.exe').resolve()
assert subprocess.check_output([node,'--version'],env=env,text=True).strip()=='v22.23.4'
expected=json.loads((q/'i4-486-combined-gates-01/after-check.json').read_bytes())
def verify():
 for x in expected:assert hashlib.sha256((repo/x['path']).read_bytes()).hexdigest()==x['sha256'],x['path']
verify();records=[]
for name,args in [('coverage',[pnpm,'exec','turbo','run','test:coverage','--concurrency=1']),*[(s,[pnpm,s]) for s in ['check:templates','check:licenses','check:docs','check:contrast']],('audit',[pnpm,'audit','--audit-level=high'])]:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (out/(name+'.log')).open('wb') as log:p=subprocess.run(args,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT)
 record={'command':args,'started':start,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode,'log':name+'.log','runtime':'v22.23.4','TEMP':str(scratch)}
 records.append(record);(out/'commands.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(record),flush=True)
 verify()
 if p.returncode:raise SystemExit(p.returncode)
(out/'result.json').write_text(json.dumps({'sourceUnchanged':True,'paths':len(expected),'allCommands':records,'originalCombinedGate':'FAILED; separate earlier records retained','priorPassingChecks':'typecheck lint layers migrations tokens deps in i4-486-combined-gates-01','serialCoverageUsesExistingCICommand':True},indent=2)+'\n')
