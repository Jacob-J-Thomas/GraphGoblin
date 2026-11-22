from pathlib import Path
import hashlib,json,shutil,subprocess,datetime
OUT=Path(r'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-486-jsonata-contract-01')
REPO=Path(r'G:\ggq\gg-i4-486-authored-errors\GraphGoblin')
def sha(b):return hashlib.sha256(b).hexdigest()
def save(p,o):p.write_bytes((json.dumps(o,indent=2)+'\n').encode('utf-8'))
def git(*a):return subprocess.run(['git',*a],cwd=REPO,check=True,capture_output=True).stdout
admission=json.loads((OUT/'admission.json').read_bytes());execution=json.loads((OUT/'execution-input.json').read_bytes());results=json.loads((OUT/'results.json').read_bytes())
assert not (OUT/'manifest.json').exists()
for name,src in [('jsonata.js',execution['dependency']['modulePath']),('package.json',execution['dependency']['packageJsonPath'])]:
 p=Path(src);dest=OUT/'dependency-inputs'/name;dest.parent.mkdir(exist_ok=True);shutil.copyfile(p,dest);assert dest.read_bytes()==p.read_bytes()
sumfile=Path(r'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-486-architecture-02\SHA256SUMS')
shutil.copyfile(sumfile,OUT/'design-inputs/SHA256SUMS')
sourcechecks=[]
for row in admission['sources']:
 p=Path(row['path']) if Path(row['path']).is_absolute() else REPO/row['path']
 snapshot=OUT/row['copy'];assert len(snapshot.read_bytes())==row['bytes'] and sha(snapshot.read_bytes())==row['sha256']
 if not Path(row['path']).is_absolute():assert sha(p.read_bytes())==row['sha256']
 sourcechecks.append({'path':row['path'],'snapshotSha256':row['sha256'],'snapshotStillMatches':True,'liveSourceRechecked':not Path(row['path']).is_absolute()})
index=Path(git('rev-parse','--git-path','index').decode().strip());index=index if index.is_absolute() else REPO/index
assert sha(index.read_bytes())==admission['indexSha256']
assert git('status','--porcelain=v1','--untracked-files=all')==b''
assert git('diff','--name-only')==b'' and git('diff','--cached','--name-only')==b''
assert git('rev-parse','HEAD').decode().strip()==admission['head']
assert len(results['results'])==40 and results['predictionMismatches']==[]
assert sha((OUT/'predictions.json').read_bytes())==execution['predictionsSha256']
assert sha((OUT/'cases.json').read_bytes())==execution['casesSha256']
assert sha((OUT/'probe.mjs').read_bytes())==execution['scriptSha256']
save(OUT/'command-outcomes.json',{'evidenceType':'Administrative transcription of observed structured exec outcomes; not a raw tool transport dump','install':{'command':'pnpm.cmd install --frozen-lockfile --offline','initialChunk':'722af5','sessionId':12186,'finalChunk':'0e1263','exit':0,'rawLog':'install.log','recordedDurationSeconds':14.8,'packagesReused':801,'downloads':0},'probe':{'command':'run.ps1 -> Node 22.23.4 + tsx loader + development condition -> probe.mjs','chunk':'5f92d4','exit':0,'wallSeconds':2.2144662,'rawLog':'run.log','driverRuns':1,'failedDriverRuns':0,'postRunFixtureCorrections':0,'topLevelCases':40,'predeclaredPredictionMismatches':0},'sealing':'Read-only source/dependency/hash checks and copies only; no behavioral rerun, source/index/lock edit or public mutation'})
save(OUT/'unexpected-observations.json',{'predeclaredPredictionMismatches':results['predictionMismatches'],'standaloneUnpredictedControl':results['regexControl'],'clarification':'Original harness called the standalone regex control deliberately incomplete, but actual no-flags Node output rejects the terminal-newline sample. That unsupported label remains unchanged in original script/results; the report does not claim a bypass.','classifications':'No classifier/helper or acceptance decision is implemented. Matched predictions are facts, not 40 accepted labels or product PASS cases.'})
save(OUT/'source-binding.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':admission['head'],'tree':admission['tree'],'statusAfter':'clean','indexSha256BeforeAndAfter':admission['indexSha256'],'sourceChecks':sourcechecks,'dependency':execution['dependency'],'predictionsAndScriptOriginalHashesStillMatchExecutionInput':True,'domainPublicEntry':execution['domainPublicEntry'],'astSourceExportVsPackageEntry':{'sourceModule':execution['expressionAstSourceExport'],'packageEntry':execution['expressionAstPackageEntryExport']},'engineCallerSourceTier':'Read-only inspection of engine primitive/exit/heartbeat/subloop/common/wait callers. Observed default options or fresh thread/index bindings, not an error override; not an exhaustive reachability/security audit and no engine runtime flow executed.','outputScope':'Private finite planning evidence only; no implementation, formal review count, plan selection/approval or public publication.'})
entries=[]
for p in sorted(p for p in OUT.rglob('*') if p.is_file() and p.name!='manifest.json'):
 b=p.read_bytes();entries.append({'path':p.relative_to(OUT).as_posix(),'bytes':len(b),'sha256':sha(b)})
save(OUT/'manifest.json',{'schema':'graphgoblin-486-jsonata-planning-evidence/1','visibility':'Private raw QA contains synthetic canaries; report is the compact read-only planning handoff. No public archive is authorized by this seal.','source':admission['head'],'tree':admission['tree'],'excludes':['manifest.json (self)'],'memberCount':len(entries),'bytes':sum(x['bytes'] for x in entries),'files':entries})
print(json.dumps({'memberCount':len(entries),'bytes':sum(x['bytes'] for x in entries),'manifestSha256':sha((OUT/'manifest.json').read_bytes()),'reportSha256':sha((OUT/'REPORT.md').read_bytes()),'caseCount':40,'predictionMismatches':0,'sourceClean':True,'indexUnchanged':admission['indexSha256']}))
