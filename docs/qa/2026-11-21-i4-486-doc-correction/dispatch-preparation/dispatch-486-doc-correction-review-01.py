from pathlib import Path
import datetime,json,subprocess,time,sys,os
E=Path('G:/ggq/delivery-evidence/2026-11-17-five-intents')
p=E/'i4-486-d209-d211-fable-review-01'
repo=Path('G:/ggq/gg-i4-486-delivery/GraphGoblin')
assert time.time()>=1795294800,'Do not dispatch before the announced five-hour reset'
os.environ['GIT_OPTIONAL_LOCKS']='0'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo).decode().strip()=='29e165e14fdda138300ba2a34585ddd47268b475'
assert not subprocess.check_output(['git','status','--porcelain'],cwd=repo)
ci=E/'i4-553-head29e-targeta608-ci/verified.json'
assert ci.is_file(),'Current source-head ordinary verification must complete first'
checked=json.loads(ci.read_bytes())
assert checked['head']=='29e165e14fdda138300ba2a34585ddd47268b475' and checked['target']=='a60843a9050b3a203726db84f6abf1f45b8bc694'
assert checked['headTree']==checked['testedTree']=='d50fb576f1ef4498cb30e52521198575d6d0ebd4' and checked['attempt']==1
assert len(checked['jobs'])==6 and all(j['conclusion']=='success' and not j['failedOrCancelledSteps'] for j in checked['jobs'].values())
native=json.loads((E/'i4-553-head29e-targeta608-ci-windows/verified.json').read_bytes())
assert native['head']==checked['head'] and native['base']==checked['target'] and native['sourceTree']==checked['headTree']
assert native['canonicalReplay'] is True and native['records']==338 and native['run']==checked['run']
assert (E/'i4-486-d209-doc-independent-01/SHA256SUMS.json').is_file(),'Independent static QA must be complete'
assert not (p/'provider').exists(),'Do not replay an existing provider invocation'
(p/'dispatch-readiness.json').write_text(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'quotaResetReached':True,'cleanHead':'29e165e14fdda138300ba2a34585ddd47268b475','target':'a60843a9050b3a203726db84f6abf1f45b8bc694','actualModel':'claude-fable-5-2','effort':'xhigh','CIRecord':str(ci),'overageOrAccountChange':False},indent=2)+'\n')
result=subprocess.run(['C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe','C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/claude-bounded-runner.mjs',str(p/'spec.json')])
sys.exit(result.returncode)
