from pathlib import Path
import subprocess, os, json, hashlib, time
root = Path.cwd().resolve()
evidence = root / '.wp-a5a-evidence'
changed = subprocess.check_output(['git','diff','--name-only','--diff-filter=ACM'], cwd=root, text=True).splitlines()
changed = [name for name in changed if '/src/' in name and name.endswith(('.ts','.tsx'))]
originals = {name:(root/name).read_bytes() for name in changed}
head = {name:subprocess.check_output(['git','show','HEAD:'+name],cwd=root) for name in changed}
new = root/'apps/api/src/testing/api-subprocess.ts'
parked = evidence/'api-subprocess.baseline-backup'
assert new.is_relative_to(root) and parked.is_relative_to(evidence)
status = {'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(), 'packages':{},'restored':False}
# Every byte of the worker patch is also saved outside the source tree before substituting HEAD.
import zipfile
with zipfile.ZipFile(evidence/'source-before-baseline.zip','w') as backup:
    for name,data in originals.items(): backup.writestr(name,data)
    backup.writestr('apps/api/src/testing/api-subprocess.ts',new.read_bytes())
env = {key:value for key,value in os.environ.items() if not key.upper().startswith('GG_') and key.upper() != 'JEV_API_KEY'}
env['PATH'] = str(Path(env['APPDATA'])/'nvm/v22.14.0')+os.pathsep+env['PATH']
report_root = Path(env['TEMP'])/('gg-wpa5a-baseline-coverage-'+str(time.time_ns()))
status['reports'] = str(report_root)
try:
    for name,data in head.items(): (root/name).write_bytes(data)
    new.rename(parked)
    for package in ['infrastructure','api','web']:
        args = ['pnpm.cmd','--filter','@graphgoblin/'+package,'test:coverage','--maxWorkers=2','--coverage.reportOnFailure','--coverage.reportsDirectory='+str(report_root/package)]
        with (evidence/('baseline-bounded-'+package+'.log')).open('w',encoding='utf8') as log:
            result = subprocess.run(subprocess.list2cmdline(args),shell=True,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
        summary_path = report_root/package/'coverage-summary.json'
        status['packages'][package] = {'command':args,'exit':result.returncode,'coverage':json.loads(summary_path.read_text())['total'] if summary_path.exists() else None}
        (evidence/'baseline-measurements.log').write_text(json.dumps(status,indent=2))
finally:
    for name,data in originals.items(): (root/name).write_bytes(data)
    if parked.exists(): parked.rename(new)
    status['restored'] = all((root/name).read_bytes()==data for name,data in originals.items())
    status['sourceHashes'] = {name:hashlib.sha256(data).hexdigest() for name,data in originals.items()}
    (evidence/'baseline-measurements.log').write_text(json.dumps(status,indent=2))
if not status['restored']: raise RuntimeError('Worker sources did not restore byte for byte')
