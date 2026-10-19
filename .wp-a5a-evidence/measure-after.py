from pathlib import Path
import subprocess, os, json, hashlib, zipfile, concurrent.futures, sys
root = Path.cwd().resolve()
evidence = root/'.wp-a5a-evidence'
baseline = json.loads((evidence/'baseline-measurements.log').read_text())
assert baseline['restored'], 'Baseline must finish restoring worker sources first'
for name,digest in baseline['sourceHashes'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest, 'Source changed since restore: '+name
with zipfile.ZipFile(evidence/'source-before-baseline.zip') as saved:
    assert (root/'apps/api/src/testing/api-subprocess.ts').read_bytes()==saved.read('apps/api/src/testing/api-subprocess.ts')
env = {key:value for key,value in os.environ.items() if not key.upper().startswith('GG_') and key.upper()!='JEV_API_KEY'}
env['PATH'] = str(Path(env['APPDATA'])/'nvm/v22.14.0')+os.pathsep+env['PATH']
folders = {'adapter-jev':'packages/adapter-jev','engine':'packages/engine','infrastructure':'packages/infrastructure','api':'apps/api','web':'apps/web'}
def measure(package):
    args = ['pnpm.cmd','--filter','@graphgoblin/'+package,'test:coverage','--maxWorkers=2','--coverage.reportOnFailure']
    with (evidence/('after-'+package+'.log')).open('w',encoding='utf8') as log:
        result = subprocess.run(subprocess.list2cmdline(args),shell=True,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
    summary_path = root/folders[package]/'coverage/coverage-summary.json'
    return package, {'command':args,'exit':result.returncode,'coverage':json.loads(summary_path.read_text())['total'] if summary_path.exists() else None}
status = {'workersPerPackage':2,'packageConcurrency':2,'packages':{}}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    pending = [executor.submit(measure, package) for package in folders]
    for completed in concurrent.futures.as_completed(pending):
        package, result = completed.result()
        status['packages'][package] = result
        (evidence/'after-measurements.log').write_text(json.dumps(status,indent=2))
status['sourceHashesUnchanged'] = all(hashlib.sha256((root/name).read_bytes()).hexdigest()==digest for name,digest in baseline['sourceHashes'].items())
(evidence/'after-measurements.log').write_text(json.dumps(status,indent=2))
if not status['sourceHashesUnchanged']: raise RuntimeError('Sources changed during final coverage')
sys.exit(1 if any(result['exit'] for result in status['packages'].values()) else 0)
