from pathlib import Path
import json,hashlib,shutil,subprocess,datetime
Q=Path(r'C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents')
OUT=Q/'i4-486-jsonata-contract-01'
REPO=Path(r'G:\ggq\gg-i4-486-authored-errors\GraphGoblin')
def sha(b):return hashlib.sha256(b).hexdigest()
def save(p,x):p.write_bytes((json.dumps(x,indent=2)+'\n').encode('utf-8'))
def git(*a):return subprocess.run(['git',*a],cwd=REPO,check=True,capture_output=True).stdout
assert git('rev-parse','HEAD').decode().strip()=='02351e2fb932b3be44e7cc3fb3943a61d568226c'
assert git('status','--porcelain=v1')==b''
index=Path(git('rev-parse','--git-path','index').decode().strip());index=index if index.is_absolute() else REPO/index
sources=[]
for rel in ['packages/domain/src/expression.ts','packages/domain/src/errors.ts','packages/domain/src/index.ts','packages/domain/package.json','patches/jsonata@2.2.2.patch','pnpm-lock.yaml','pnpm-workspace.yaml','AGENTS.md']:
 p=REPO/rel;dest=OUT/'source-inputs'/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);b=p.read_bytes();sources.append({'path':rel,'copy':dest.relative_to(OUT).as_posix(),'bytes':len(b),'sha256':sha(b)})
for name in ['README.md','boundaries.md','verification.md','critique-disposition.md']:
 p=Q/'i4-486-architecture-02'/name;dest=OUT/'design-inputs'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);b=p.read_bytes();sources.append({'path':str(p),'copy':dest.relative_to(OUT).as_posix(),'bytes':len(b),'sha256':sha(b)})
cases=[]
label='PRIVATE_C486_LABEL'
def error(s):return '$error('+json.dumps(s)+')'
def add(id,source,root='function',code='D3137',outcome='throw',profile='default',input=None,note='AST/runtime fact only; no classifier is implemented or accepted'):
 cases.append({'id':id,'source':source,'bindingProfile':profile,'input':{} if input is None else input,'prediction':{'astRootType':root,'rawOutcome':outcome,'rawCode':code,'domainOutcome':outcome,'domainCode':'EXPRESSION_ERROR' if outcome=='throw' else None},'planningQuestion':note})
add('C01-min-1',error('A'))
add('C02-max-128',error('L'*128))
add('C03-source-whitespace',' \n\t '+error(label)+' \n')
add('C04-single-quoted',"$error('"+label+"')")
add('C05-escaped-ascii',r'$error("\u0041")')
add('C06-grouped','('+error(label)+')','block')
add('C07-block-extra','(1;'+error(label)+')','block')
add('C08-conditional-throw','true ? '+error(label)+' : 1','condition')
add('C09-conditional-not-taken','false ? '+error(label)+' : 1','condition',None,'return')
add('C10-nested-call','$string('+error(label)+')')
add('C11-eval','$eval('+json.dumps(error(label))+')',code='D3121')
add('C12-dynamic-path','$error(label)',input={'label':'PRIVATE_C486_DYNAMIC_CANARY'})
add('C13-dynamic-concat','$error("PRIVATE_C486_" & "COMPUTED")')
add('C14-assert-false','$assert(false,"PRIVATE_C486_ASSERT")',code='D3141')
add('C15-assert-true','$assert(true,"PRIVATE_C486_ASSERT")',code=None,outcome='return')
add('C16-empty',error(''))
add('C17-length-129',error('L'*129))
add('C18-unicode',error('PRIVATE_C486_é'))
add('C19-trailing-newline',error(label+'\n'))
add('C20-carriage-return',error(label+'\r'))
add('C21-tab',error(label+'\t'))
add('C22-nul',error(label+'\x00'))
add('C23-del',error(label+'\x7f'))
add('C24-excluded-punctuation',error(label+'.'))
add('C25-space-only',error(' '))
add('C26-zero-arguments','$error()')
add('C27-two-arguments','$error("PRIVATE_C486_LABEL","EXTRA")',code='T0410')
add('C28-lexical-shadow','($error := function($x){$x}; '+error(label)+')','block',None,'return')
add('S01-own-enumerable-return',error(label),code=None,outcome='return',profile='enumerable-return')
add('S02-own-enumerable-same-code',error(label),profile='enumerable-same-code')
add('S03-jsonata-function-same-code',error(label),profile='jsonata-function-same-code')
add('S04-nonenumerable-error',error(label),profile='nonenumerable-error')
add('S05-inherited-error',error(label),profile='inherited-error')
add('S06-error-getter-throws',error(label),code=None,profile='error-getter-throws')
add('S07-actual-builtin-object',error(label),profile='actual-builtin')
add('S08-dollar-prefixed-key',error(label),profile='dollar-prefixed')
add('S09-input-error-property',error(label),profile='input-error-property')
add('S10-injected-domain-error',error(label),code='EXPRESSION_ERROR',profile='domain-error')
add('S11-other-binding-getter-throws',error(label),code=None,profile='other-getter-throws')
add('S12-post-shadow-cache-builtin',error(label))
assert len(cases)==40
save(OUT/'cases.json',{'scope':'Fixed forty-case planning discriminators; deterministic literal boundaries, not algorithmic fuzzing. Raw synthetic canaries remain private to this QA root. No proposed classifier/helper is implemented.','cases':cases})
save(OUT/'predictions.json',{'writtenAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'writtenBeforeExecution':True,'casesSha256':sha((OUT/'cases.json').read_bytes()),'expectedCaseCount':40,'predictionsAreNotAcceptance':'Predicted AST types/raw error codes are fallible hypotheses. Retain every mismatch; no case is called a product PASS or permission to expose a label.','sourceOnlyHypotheses':['Root direct AST name cannot establish builtin identity when the public options.bindings API supplies an own enumerable replacement.','Nonenumerable/inherited bindings.error is omitted by object spread. A getter can throw during spread before JSONata evaluates.','Public evaluateExpression wraps raw D3137 as EXPRESSION_ERROR without retaining the raw code; existing ExpressionError is passed through.','expressionAst is a source-module export, not a package-entry export.','Engine callers currently passing defaults or ordinary thread/index bindings are a narrower reachability tier than arbitrary public low-level ExpressionOptions.'],'predictions':[{'id':c['id'],**c['prediction']} for c in cases]})
save(OUT/'admission.json',{'head':git('rev-parse','HEAD').decode().strip(),'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'statusBefore':'clean','indexSha256':sha(index.read_bytes()),'nodeModulesPresent':(REPO/'node_modules').exists(),'sources':sources,'scope':'Read-only planning validation. Frozen offline installation permitted; no source/index/lock changes, implementation, formal review, plan approval or public mutation.'})
print(json.dumps({'cases':len(cases),'predictionsSha256':sha((OUT/'predictions.json').read_bytes()),'nodeModulesPresent':(REPO/'node_modules').exists()}))
