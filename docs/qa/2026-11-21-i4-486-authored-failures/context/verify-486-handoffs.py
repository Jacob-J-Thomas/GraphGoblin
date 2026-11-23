from pathlib import Path
import hashlib,json,datetime,subprocess
q=Path(__file__).resolve().parent
repo=Path('G:/ggq/gg-i4-486-authored-errors/GraphGoblin')
out=q/'i4-486-combined-build-01'/'author-source-verification.json'
assert not out.exists()
inputs={
 'A':('i4-486-core-author-01/core-final-source-v2.json','c73614749b0be72320b7dcd52d899b66df282f45e9713b358aae81a2e5d2b975'),
 'W':('i4-486-workspace-author-01/source-after.json','51cf7fb653d695eeab0b82f1656eff4a88027b0b308c0ac682b35e798291bd27'),
 'L':('i4-486-leaf-author-01/source-after-binding.json','1b5a8a4de97125d040f7494c318525dd8e6ef91f534d64b62835468f62adfc70'),
}
seen=set(); result={}
for owner,(name,wanted) in inputs.items():
 raw=(q/name).read_bytes();actual=hashlib.sha256(raw).hexdigest()
 assert actual==wanted,(owner,actual,wanted)
 data=json.loads(raw)
 files=data['sha256'] if owner=='A' else {r['path']:r['sha256'] for r in data}
 rows=[]
 for name,wanted in files.items():
  assert name not in seen,name
  seen.add(name)
  raw=(repo/name).read_bytes(); actual=hashlib.sha256(raw).hexdigest()
  assert actual==wanted,(name,actual,wanted)
  rows.append({'path':name,'sha256':actual,'bytes':len(raw),'match':True})
 result[owner]={'input':inputs[owner][0],'inputSHA256':inputs[owner][1],'files':rows}
build=json.loads((out.parent/'result.json').read_bytes())
assert build['exitCode']==0
receipt={'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repo':str(repo),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'distinctFiles':len(seen),'owners':result,'build':build,'qualification':'A/W/L stable production and owned tests match author handoffs after combined build. T owns separate public tests still in progress. Not a final combined-source freeze, coverage pass, independent QA or review.'}
out.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'path':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'distinctFiles':len(seen),'allMatch':True}))
