from pathlib import Path
import subprocess,os,shutil,hashlib,json,datetime
q=Path(__file__).resolve().parent
repo=Path('G:/ggq/gg-i4-486-authored-errors/GraphGoblin')
out=q/'i4-486-combined-gates-01'
scratch=Path('C:/Users/98jak/AppData/Local/Temp/gg486-gates-01')
runtime=Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')
assert not out.exists() and not scratch.exists()
assert shutil.disk_usage('C:/').free>1024**3
out.mkdir();scratch.mkdir()
env={**os.environ,'PATH':str(runtime)+os.pathsep+os.environ['PATH'],'TEMP':str(scratch),'TMP':str(scratch)}
assert env.get('LIVE')!='1' and env.get('LIVE_CLAUDE')!='1'
pnpm=shutil.which('pnpm.cmd',path=env['PATH']);node=shutil.which('node.exe',path=env['PATH'])
assert Path(node).resolve()==(runtime/'node.exe').resolve()
version=subprocess.check_output([node,'--version'],env=env,text=True).strip();assert version=='v22.23.4'
def git(*args):return subprocess.check_output(['git',*args],cwd=repo)
assert not git('diff','--cached','--name-only')
paths=sorted(set(git('diff','--name-only','-z').decode().split('\0')[:-1]+git('ls-files','--others','--exclude-standard','-z').decode().split('\0')[:-1]))
assert paths and all(p.startswith(('packages/','apps/api/src/','docs/')) or p=='CHANGELOG.md' for p in paths)
assert all(Path(p).suffix in ['.ts','.md'] for p in paths)
def snapshot(label):
 entries=[]
 for name in paths:
  p=repo/name;b=p.read_bytes();dest=out/label/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
  entries.append({'path':name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
 (out/(label+'.json')).write_text(json.dumps(entries,indent=2)+'\n')
 return entries
before=snapshot('before-format');records=[]
def run(name,args):
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (out/(name+'.log')).open('wb') as stream:p=subprocess.run(args,cwd=repo,env=env,stdout=stream,stderr=subprocess.STDOUT)
 record={'command':args,'runtime':version,'cwd':str(repo),'TEMP':str(scratch),'started':start,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode,'log':name+'.log'}
 records.append(record);(out/'commands.json').write_text(json.dumps(records,indent=2)+'\n')
 print(json.dumps(record),flush=True)
 return p.returncode
assert run('format-touched',[pnpm,'exec','prettier','--write',*paths])==0
after=snapshot('after-format')
assert run('diff-check',['git','diff','--check'])==0
result=run('check',[pnpm,'check'])
end=snapshot('after-check')
assert after==end,'Source changed during combined gate'
summary={'base':git('rev-parse','HEAD').decode().strip(),'paths':paths,'formattedFiles':[b['path'] for a,b in zip(before,after) if a['sha256']!=b['sha256']],'sourceUnchangedDuringCheck':True,'checkExit':result,'normalCoverageThresholdsUnmodified':True,'testRuntime':version,'temporaryVolumeChoice':'C: preserves the existing native short-name case; G: lack of 8.3 support was already measured in W evidence. No host/global configuration changes.','freeCAtEnd':shutil.disk_usage('C:/').free,'allCommands':records}
(out/'result.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'checkExit':result,'changedFiles':len(paths),'formatOnlyChangedFiles':summary['formattedFiles'],'result':str(out/'result.json')}),flush=True)
raise SystemExit(result)
