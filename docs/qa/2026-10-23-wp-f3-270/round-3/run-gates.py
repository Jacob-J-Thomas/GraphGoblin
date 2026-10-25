"""Requested round-3 root gates and browser checks; preserve every command result."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
qa = Path(__file__).resolve().parent
root = Path.cwd()
def capture(name, command, cwd=None):
    return subprocess.call([sys.executable, str(qa / 'run-check.py'), name, *command], cwd=cwd or root)
while not any(json.loads(line)['name'] == 'format' for line in (qa / 'commands.log.txt').read_text(encoding='utf-8').splitlines()):
    time.sleep(1)
for name, command in [
 ('typecheck',['pnpm.cmd','typecheck','--concurrency=1']),
 ('lint',['pnpm.cmd','lint','--concurrency=1']),
 ('check-docs',['pnpm.cmd','check:docs']),
 ('check-migrations',['pnpm.cmd','check:migrations']),
 ('check-layers',['pnpm.cmd','check:layers']),
 ('check-deps',['pnpm.cmd','check:deps']),
 ('check-tokens',['pnpm.cmd','check:tokens']),
 ('build',['pnpm.cmd','build','--concurrency=1']),
 ('upgrade',['pnpm.cmd','test:upgrade']),
]:
    result = capture(name, command)
    if name == 'upgrade' and result != 0:
        capture('upgrade-isolated', command)
capture('e2e', ['pnpm.cmd','exec','playwright','test','e2e/unlimited-mode.spec.ts','e2e/stored-loop-defaults.spec.ts','--retries=0'], root / 'apps/web')
print('ROOT GATES FINISHED', flush=True)
