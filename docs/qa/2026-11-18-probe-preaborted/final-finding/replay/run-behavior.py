import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
from datetime import datetime,timezone

D=pathlib.Path(__file__).resolve().parent
base=D.parent
work=base/'pr505-final-disposable-work-01'
previous=base/'pr505-outer-lifecycle-independent-qa-01'
source=pathlib.Path(os.environ['GG505_VERIFIED_CHECKOUT'])
case=sys.argv[1]
durable=D/case
durable.mkdir()
inp=durable/'input'
inp.mkdir()
scratch=base/'pr505-final-disposable-outputs-01'
temp=scratch/'temp'/case
temp.mkdir(parents=True)
def h(b):return hashlib.sha256(b).hexdigest()
def md(p):return h(p.read_bytes())
def now():return datetime.now(timezone.utc).isoformat()
def write_json(p, d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
active=work/'packages/adapter-codex/src'
tested=active/'probe-directory.test.ts'
cli=active/'fixtures/readiness-cli.mjs'
assert md(tested)=='e211bfdc49b1a465e4b1b0d997f028005112d003282417c7286172f928e15e75'
env=os.environ.copy()
for v in ['TEMP','TMP','TMPDIR']:env[v]=str(temp)
env.update({'LIVE':'0','TURBO_TELEMETRY_DISABLED':'1','GG_466_QA_OBSERVATION':str(durable/'events.jsonl'),'GG505_EVENTS':str(durable/'events.jsonl'),'GG505_MARKER':str(durable/'ready.json'),'NO_COLOR':'1','CI':'1'})
env['PATH']=str(pathlib.Path.home()/'.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')+os.pathsep+env['PATH']
pnpm=shutil.which('pnpm.cmd',path=env['PATH'])
node=shutil.which('node.exe',path=env['PATH'])
assert subprocess.check_output([node,'--version'],env=env).strip()==b'v22.23.4'
binaries={'node':'v22.23.4','pnpm':subprocess.check_output([pnpm,'--version'],env=env).decode().strip()}
assert binaries['pnpm']=='12.8.1'
pathRoot=work.as_posix()
vconfig={'root':inp.as_posix(),'cacheDir':(scratch/'cache'/case).as_posix(),'resolve':{'conditions':['development'],'alias':{'vitest':(work/'packages/adapter-codex/node_modules/vitest/dist/index.js').as_posix()}},'test':{'include':['*.test.ts'],'environment':'node','clearMocks':True,'restoreMocks':True,'pool':'forks','execArgv':['--expose-gc']}}
remarks=[]
if case in {'focused','adapter-coverage'}:
    if case=='focused':
        args=[pnpm,'--filter','@graphgoblin/adapter-codex','run','test','src/probe-directory.test.ts']
    else:
        args=[pnpm,'--filter','@graphgoblin/adapter-codex','run','test:coverage','--coverage.reportsDirectory='+str(scratch/'coverage')]
    args+=['--reporter=verbose','--reporter=json','--outputFile='+str(durable/'vitest.json')]
elif case in {'outer-ordinary','outer-combined-early','helper-live','helper-double-fault','cancel-live','cancel-before-case','cancel-before-case-v2','cancel-before-case-control','cancel-before-case-entry','cancel-before-case-public','cancel-before-case-public-entry'}:
    if case.startswith('cancel-before-case'):
        raw=tested.read_bytes()
        raw=raw.replace(b"from './index.js'",f"from '{pathRoot}/packages/adapter-codex/src/index.ts'".encode()).replace(b"from './cli.js'",f"from '{pathRoot}/packages/adapter-codex/src/cli.ts'".encode()).replace(b"'./fixtures/readiness-cli.mjs'",b"'./readiness-cli.mjs'")
        if case.endswith('control'):
            old=b"    enclosing.addEventListener('abort', () => controller.abort(enclosing.reason), { once: true });"
            assert raw.count(old)==1
            raw=raw.replace(old,b"    if (enclosing.aborted) controller.abort(enclosing.reason);\n    else "+old.strip())
            remarks.append('Counterfactual only. Immediately propagate a previously aborted enclosing signal, otherwise retain the existing listener. All maintained case assertions retained.')
        if case.endswith('entry'):
            for old in [b'    const children: ChildProcess[] = [];',b'      const lifecycle = controlledLifecycle(context.signal);']:
                assert raw.count(old)==1
                indent=old[:len(old)-len(old.lstrip())]
                raw=raw.replace(old,indent+b'context.signal.throwIfAborted();\n'+old)
            remarks.append('Counterfactual only. Check context.signal.throwIfAborted() before starting either owned wrapper. No other maintained logic changed.')
        suffix=(D/'cancel-before-case.ts.txt').read_bytes()
        if case!='cancel-before-case':
            change=b"  expect(entries).toEqual([]);"
            assert suffix.count(change)==1
            suffix=suffix.replace(change,b"  expect(entries.filter(name=>name.startsWith('gg-codex-'))).toEqual([]);")
            remarks.append('The initial afterAll also asserted Vitest-owned temporary artifacts absent while Vitest was still active. This observer restricts that assertion to maintained case roots and keeps the complete listing and initial result.')
        scenario=raw+b'\n'+suffix
        pattern='under a 226-character' if 'public' in case else 'reports an ordinary case failure once'
        vconfig['test']['testNamePattern']=pattern
        remarks.append(f'Full maintained suite with relocated imports/fixture plus a public beforeEach rendezvous and afterAll native-child assertions. Filter {pattern}. Observes dependency spawn without replacing native execution.')
    else:
        template=(previous/('final-'+case.removeprefix('outer-')+'-input')/'outer-timeout.test.ts') if case.startswith('outer-') else previous/'final-helper-timeout-input/helper-timeout.test.ts'
        if case.startswith('outer-'): generation=previous/('final-'+case.removeprefix('outer-')+'-input')/'generation.json'
        else:generation=previous/'final-helper-timeout-input/generation.json'
        g=json.loads(generation.read_bytes());assert g['candidateSha256']==md(tested) and md(template)==g['generatedSha256']
        raw=template.read_bytes()
        old=source.as_posix().encode()
        assert raw.count(old)==2
        scenario=raw.replace(old,pathRoot.encode())
        if case in ('helper-live','cancel-live'):env['GG_466_QA_SCENARIO']='live'
        if case=='helper-double-fault':env['GG_466_QA_SCENARIO']='double-fault'
        remarks.append('Retained hash-bound native witness reused verbatim except relocating its two workspace imports to the disposable identical tree. The parent drives a user cancellation in cancel-live.')
    gen=inp/'probe-audit.test.ts'
    gen.write_bytes(scenario)
    (inp/'readiness-cli.mjs').write_bytes(cli.read_bytes())
    (inp/'vitest.config.mjs').write_text('export default '+json.dumps(vconfig,indent=2)+';\n',encoding='utf-8')
    if case.startswith('cancel-'): args=[node,str(D/'cancel-run.mjs'),case]
    else:args=[pnpm,'--filter','@graphgoblin/adapter-codex','exec','vitest','run','--config',str(inp/'vitest.config.mjs'),'--reporter=verbose','--reporter=json','--outputFile='+str(durable/'vitest.json')]
else:raise ValueError(case)
receipt={'case':case,'head':'0ff00d6717bfb397e42bf85db8fe62ed1fc0d9b7','inputTestSha256':md(tested),'fixtureSha256':md(cli),'generatedSha256':md(gen) if 'gen' in locals() else None,'runtime':binaries,'argv':args,'remarks':remarks,'start':now()}
with (durable/'console.log').open('wb') as log:
    run=subprocess.run(args,env=env,cwd=work,stdout=log,stderr=subprocess.STDOUT,timeout=180)
receipt.update({'exit':run.returncode,'end':now(),'ownedScratchEntries':sorted(str(p.relative_to(temp)) for p in temp.rglob('*')),'consoleSha256':md(durable/'console.log')})
if (durable/'vitest.json').exists():
    v=json.loads((durable/'vitest.json').read_bytes())
    receipt['testCounts']={x:v.get(x) for x in ['numPassedTests','numFailedTests','numPendingTests','numFailedTestSuites','success']}
    receipt['tasks']=[{'title':x['title'],'status':x['status'],'errors':[err.splitlines()[0] for err in x.get('failureMessages',[])]} for suite in v['testResults'] for x in suite.get('assertionResults',[]) if case!='adapter-coverage' or x['status']!='passed']
    receipt['suiteMessages']=[s['message'].splitlines()[0] for s in v['testResults'] if s.get('message')]
if case=='adapter-coverage' and (scratch/'coverage/coverage-summary.json').exists():
    receipt['coverage']=json.loads((scratch/'coverage/coverage-summary.json').read_bytes())['total']
write_json(durable/'receipt.json',receipt)
print(json.dumps({k:receipt.get(k) for k in ['case','exit','testCounts','suiteMessages','ownedScratchEntries']}))
