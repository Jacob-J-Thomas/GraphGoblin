"""D212: inspect now; root may dispatch one bounded actual Fable review after reset."""
from pathlib import Path
import argparse,datetime,json,runpy,subprocess,sys,time

OUT=Path(__file__).resolve().parent
B=runpy.run_path(str(OUT/'bindings.py'))
globals().update({k:v for k,v in B.items() if not k.startswith('__')})

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['inspect','dispatch']);parser.add_argument('--config',required=True)
    args=parser.parse_args();path=Path(args.config).resolve()
    require(path.parent==OUT,'Use a new root-admitted configuration in this preparation directory')
    config=read(path);require(config['schema']=='graphgoblin-d212-bounded-review/1','Wrong guard configuration')
    inventory=read(OUT/'input-inventory.json')
    require(record(OUT/'input-inventory.json')['sha256']==config['inventorySha256'],'Guard inventory changed')
    for item in config['fixedPreparationFiles']:verify(item)
    bound=evidence_bindings(inventory)
    require(not (REVIEW/'provider').exists() and not (REVIEW/'dispatch-readiness.json').exists(),'Do not replay an existing invocation')
    ready=time.time()>=RESET
    result={**bound,'quotaResetEpoch':RESET,'quotaResetReached':ready,'actualModel':'claude-fable-5-2','effort':'xhigh','review':str(REVIEW),'rootExecutionAuthorized':config.get('rootExecutionAuthorized') is True,'generalScansConsumed':2,'generalScan3Authorized':False}
    if args.action=='inspect':
        print(json.dumps(result,indent=2));return 0
    require(ready,'Do not dispatch before announced quota reset')
    require(config.get('rootExecutionAuthorized') is True and config.get('rootAdmission'),'Root must review and admit a new execution configuration')
    require(subprocess.check_output([str(NODE),'--version'],env=ENV).decode().strip()=='v22.23.4','Wrong explicit Node runtime')
    write_new(REVIEW/'dispatch-readiness.json',{**result,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rootAdmission':config['rootAdmission'],'configuration':record(path),'overageOrAccountChange':False,'wholeCIClaimedPassing':False})
    completed=subprocess.run([str(NODE),str(RUNNER),str(REVIEW/'spec.json')],env=ENV)
    after=source_state();write_new(REVIEW/'dispatch-source-after.json',{'source':after,'sameSourceAndIndex':after==bound['source'],'providerProcessExit':completed.returncode})
    require(after==bound['source'],'Source/index changed during actual bounded provider invocation')
    return completed.returncode

if __name__=='__main__':
    try:sys.exit(main())
    except (OSError,ValueError,KeyError,subprocess.CalledProcessError) as error:
        print(json.dumps({'status':'REFUSED','reason':str(error),'wholeCiConclusion':'failure','noGeneralScan3OrMergeAuthorization':True}),file=sys.stderr);sys.exit(2)
