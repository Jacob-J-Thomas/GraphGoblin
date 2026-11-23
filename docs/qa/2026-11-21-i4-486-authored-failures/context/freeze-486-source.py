from pathlib import Path
import json,subprocess,hashlib,os,re
q=Path(__file__).resolve().parent;r=Path('G:/ggq/gg-i4-486-authored-errors/GraphGoblin');out=q/'i4-486-source-freeze-01';out.mkdir(exist_ok=False)
env={**os.environ,'GIT_OPTIONAL_LOCKS':'0'}
def git(*args):return subprocess.check_output(['git',*args],cwd=r,env=env)
sha=lambda b:hashlib.sha256(b).hexdigest()
base='02351e2fb932b3be44e7cc3fb3943a61d568226c';assert git('rev-parse','HEAD').decode().strip()==base
expected=json.loads((q/'i4-486-combined-gates-01/after-check.json').read_bytes());paths=[x['path'] for x in expected]
assert len(paths)==52 and not git('diff','--cached','--name-only')
dirty=set(git('diff','--name-only','-z').decode().split('\0')[:-1]+git('ls-files','--others','--exclude-standard','-z').decode().split('\0')[:-1]);assert dirty==set(paths),dirty-set(paths)
for x in expected:assert sha((r/x['path']).read_bytes())==x['sha256'],x['path']
git('diff','--check');(out/'tracked-before.patch').write_bytes(git('diff','--binary'))
git('add','--',*paths);assert set(git('diff','--cached','--name-only','-z').decode().split('\0')[:-1])==set(paths)
for x in expected:assert sha(git('show',':'+x['path']))==x['sha256'],x['path']
git('diff','--cached','--check');(out/'staged-complete.patch').write_bytes(git('diff','--cached','--binary'))
(out/'commit.log').write_bytes(git('commit','-m','Classify authored execution failures at their source'))
head=git('rev-parse','HEAD').decode().strip();tree=git('rev-parse','HEAD^{tree}').decode().strip();assert git('rev-parse','HEAD^').decode().strip()==base and not git('status','--porcelain')
for x in expected:assert sha(git('show',head+':'+x['path']))==x['sha256'],x['path']
a=(q/'i4-486-serial-gates-01/coverage.log').read_text(encoding='utf-8');b=(q/'i4-486-windows-controls-01/base-four-files.log').read_text(encoding='utf-8');pattern=r'FAIL\s+(src/[^\n]+)';casesA=re.findall(pattern,a);casesB=re.findall(pattern,b);assert len(casesA)==52 and sorted(casesA)==sorted(casesB)
receipt={'head':head,'tree':tree,'parent':base,'files':expected,'clean':True,'pushed':False,'localCombinedGate':'FAILED four original cases; finite candidate/base controls pass; original retained','localSerialCoverage':'Domain484 and Engine1998 pass; infrastructure52fail1115pass; later packages not reached','baseWindowsControl':'52samefailedcases157pass across4unchangedfiles, no full coverage claim','baselineCaseNames':casesA,'otherChecks':'All repository checks passed in combined-gates-01 and windows-controls-01 separate receipts','required':'Actual Claude general review, separate independent touched-system QA, current-head/current-target full hosted CI/coverage/native and fresh final Astra audit'}
(out/'receipt.json').write_bytes((json.dumps(receipt,indent=2)+'\n').encode());print(json.dumps({'head':head,'tree':tree,'files':len(expected),'clean':True}))
