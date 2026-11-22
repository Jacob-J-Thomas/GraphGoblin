import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

P = Path(__file__).resolve().parent
R = Path('G:/ggq/gg-i4-553-browser-diagnostic/GraphGoblin')
runtime = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64'
env = dict(os.environ)
env.update(PATH=str(runtime) + os.pathsep + env['PATH'], TEMP=str(P/'temp'), TMP=str(P/'temp'),
           npm_config_cache=str(P/'cache'), XDG_CACHE_HOME=str(P/'cache'),
           PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1', GG_E2E_BROWSER_CHANNEL='msedge', LIVE='0', CI='1',
           GG_PWA_DIAGNOSTIC_DIR=str(P), TURBO_TELEMETRY_DISABLED='1')
stage = sys.argv[1]
if stage == 'install':
    args=['pnpm.cmd','install','--offline','--frozen-lockfile','--store-dir','G:/.pnpm-store','--ignore-scripts']
elif stage == 'build':
    args=['pnpm.cmd','--filter','@graphgoblin/web','build']
elif stage == 'build-dependencies':
    args=['pnpm.cmd','exec','turbo','run','build','--filter=@graphgoblin/web...','--concurrency=1']
elif stage in ['isolated','sequence']:
    attempt=P/'attempts'/stage
    attempt.mkdir(exist_ok=False)
    env['GG_PWA_DIAGNOSTIC_ATTEMPT']=stage
    env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(attempt/'results.json')
    env['PLAYWRIGHT_HTML_OUTPUT_DIR']=str(attempt/'html')
    grep='another tab.s unresolved voice upload vetoes update activation until that tab closes'
    if stage=='sequence':
        grep='an open window detects a changed worker on focus|two clean tabs reload after an update found more than 60 seconds|cold offline Loops reload recovers|'+grep
    args=['pnpm.cmd','--filter','@graphgoblin/web','test:e2e','e2e/pwa.spec.ts','--grep',grep,
          '--trace','on','--output',str(attempt/'test-results'),'--reporter','list,json']
else:
    raise SystemExit('Unknown stage')

start=datetime.datetime.now(datetime.timezone.utc).isoformat()
log=P/(stage+'.log')
with log.open('wb') as stream:
    child=subprocess.Popen(['cmd.exe','/d','/c',*args],cwd=R,env=env,stdout=stream,stderr=subprocess.STDOUT,
                           creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    receipt={'stage':stage,'startUTC':start,'pid':child.pid,'command':args,'cwd':str(R),
             'environmentOverrides':{k:env[k] for k in ['TEMP','TMP','npm_config_cache','XDG_CACHE_HOME','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD','GG_E2E_BROWSER_CHANNEL','LIVE','CI']}}
    (P/(stage+'-started.json')).write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'stage':stage,'pid':child.pid,'log':str(log)}),flush=True)
    code=child.wait()
receipt.update(endUTC=datetime.datetime.now(datetime.timezone.utc).isoformat(),exitCode=code,
               logBytes=log.stat().st_size,logSha256=hashlib.sha256(log.read_bytes()).hexdigest())
(P/(stage+'-receipt.json')).write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf8')
print(json.dumps({'stage':stage,'exitCode':code,'logBytes':receipt['logBytes']}),flush=True)
raise SystemExit(code)
