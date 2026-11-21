from pathlib import Path
import os,shutil,subprocess,json,hashlib,datetime
q=Path(__file__).resolve().parent
out=q/'i4-486-qa-checkout-preparation-01'
repo=Path('G:/ggq/gg-i4-486-qa/GraphGoblin')
origin=Path('C:/Users/98jak/source/repos/GraphGoblin')
base='02351e2fb932b3be44e7cc3fb3943a61d568226c'
runtime=Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')
scratch=Path('G:/ggq/qa-scratch/i4-486-qa-install-01')
assert not repo.exists() and not out.exists()
assert shutil.disk_usage('G:/').free>40*1024**3
out.mkdir();scratch.mkdir(parents=True)
env={**os.environ,'PATH':str(runtime)+os.pathsep+os.environ['PATH'],'TEMP':str(scratch),'TMP':str(scratch)}
node=shutil.which('node.exe',path=env['PATH']);pnpm=shutil.which('pnpm.cmd',path=env['PATH'])
assert Path(node).resolve()==(runtime/'node.exe').resolve() and pnpm
version=subprocess.check_output([node,'--version'],env=env,text=True).strip();assert version=='v22.23.4'
records=[]
def command(cwd,args,input=None):
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 p=subprocess.run(args,cwd=cwd,env=env,input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 n=len(records)+1
 (out/f'{n:02d}.stdout').write_bytes(p.stdout);(out/f'{n:02d}.stderr').write_bytes(p.stderr)
 records.append({'cwd':str(cwd),'args':args,'started':start,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':p.returncode,'stdout':f'{n:02d}.stdout','stderr':f'{n:02d}.stderr'})
 (out/'commands.json').write_text(json.dumps(records,indent=2)+'\n')
 assert p.returncode==0,(args,p.stderr.decode(errors='replace'))
 return p.stdout
assert command(origin,['git','rev-parse',base+'^{commit}']).decode().strip()==base
command(origin,['git','worktree','add','--detach','--no-checkout',str(repo),base])
command(repo,['git','sparse-checkout','set','--no-cone','--stdin'],b'/*\n!/docs/qa/*\n/docs/qa/design-contrast.md\n')
command(repo,['git','read-tree','-mu','HEAD'])
assert not command(repo,['git','status','--porcelain'])
lock=(repo/'pnpm-lock.yaml').read_bytes()
command(repo,[pnpm,'install','--offline','--frozen-lockfile','--store-dir','G:/.pnpm-store','--reporter=append-only'])
assert (repo/'pnpm-lock.yaml').read_bytes()==lock
assert not command(repo,['git','status','--porcelain'])
receipt={'path':str(repo),'base':base,'node':version,'pnpm':pnpm,'lockSHA256':hashlib.sha256(lock).hexdigest(),'offlineFrozenInstall':True,'clean':True,'detached':True,'sparseDocumentation':'Existing docs/qa is omitted except design-contrast; all source and governing docs present. No source change, candidate build or independent QA is claimed. Checkout awaits final #486 source freeze.'}
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
