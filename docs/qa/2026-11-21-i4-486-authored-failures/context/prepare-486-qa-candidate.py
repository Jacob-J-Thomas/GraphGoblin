from pathlib import Path
import subprocess,json,hashlib,os,shutil,datetime
q=Path(__file__).resolve().parent;r=Path('G:/ggq/gg-i4-486-qa/GraphGoblin');author=Path('G:/ggq/gg-i4-486-authored-errors/GraphGoblin');out=q/'i4-486-qa-candidate-preparation-01';out.mkdir(exist_ok=False)
runtime=Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64');scratch=Path('G:/ggq/qa-scratch/i4-486-qa-build-01');scratch.mkdir(exist_ok=False)
env={**os.environ,'PATH':str(runtime)+os.pathsep+os.environ['PATH'],'TEMP':str(scratch),'TMP':str(scratch),'GIT_OPTIONAL_LOCKS':'0'}
def git(*a):return subprocess.check_output(['git',*a],cwd=r,env=env)
assert not git('status','--porcelain') and git('rev-parse','HEAD').decode().strip()=='02351e2fb932b3be44e7cc3fb3943a61d568226c'
receipt=json.loads((q/'i4-486-source-freeze-01/receipt.json').read_bytes());head=receipt['head']
git('fetch','--no-tags',str(author),head);git('checkout','--detach',head)
assert git('rev-parse','HEAD^{tree}').decode().strip()==receipt['tree'] and not git('status','--porcelain')
for x in receipt['files']:assert hashlib.sha256((r/x['path']).read_bytes()).hexdigest()==x['sha256'],x['path']
pnpm=shutil.which('pnpm.cmd',path=env['PATH']);start=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (out/'build.log').open('wb') as log:p=subprocess.run([pnpm,'build'],cwd=r,env=env,stdout=log,stderr=subprocess.STDOUT)
assert not git('status','--porcelain')
record={'head':head,'tree':receipt['tree'],'filesVerified':52,'sourceClean':True,'buildExitCode':p.returncode,'started':start,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runtime':'v22.23.4','TEMP':str(scratch),'kind':'Root preparation only; independent QA must bind built outputs and author its own checks'}
(out/'receipt.json').write_bytes((json.dumps(record,indent=2)+'\n').encode());print(json.dumps(record),flush=True);raise SystemExit(p.returncode)
