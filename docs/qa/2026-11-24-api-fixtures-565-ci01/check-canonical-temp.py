"""Owned junction control for the hosted short-path assertion failure; no product changes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
WORKTREE = Path('G:/ggq/gg-fu-api-fixtures-20261124/GraphGoblin')
NODE = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64'
mode = sys.argv[1]
if mode not in ('baseline', 'corrected'):
    raise SystemExit('Expected baseline or corrected')
out = ROOT / mode
out.mkdir(exist_ok=False)
target = ROOT / ('temporary-target-' + mode)
alias = ROOT / ('temporary-alias-' + mode)
target.mkdir(exist_ok=False)
env = os.environ.copy()
env['PATH'] = str(NODE) + os.pathsep + env['PATH']
env['GG_TEST_PORT_START'] = '62000'
env['GG_TEST_PORT_COUNT'] = '100'
env['TEMP'] = env['TMP'] = str(alias)
env['GIT_OPTIONAL_LOCKS'] = '0'
subprocess.run([str(NODE / 'node.exe'), '-e', "require('node:fs').symlinkSync(process.argv[1],process.argv[2],'junction')", str(target), str(alias)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
command = 'pnpm --filter @graphgoblin/api test src/main.test.ts --reporter=verbose'
source = WORKTREE / 'apps/api/src/main.test.ts'
before = hashlib.sha256(source.read_bytes()).hexdigest()
result = subprocess.run(['C:/Program Files/Git/bin/bash.exe', '--noprofile', '--norc', '-c', command], cwd=WORKTREE, env=env, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
(out / 'stdout.log').write_bytes(result.stdout)
(out / 'stderr.log').write_bytes(result.stderr)
after = hashlib.sha256(source.read_bytes()).hexdigest()
receipt = {'mode': mode, 'command': command, 'exitCode': result.returncode, 'sourceBefore': before, 'sourceAfter': after, 'sourceUnchanged': before == after, 'temporaryAlias': str(alias), 'temporaryTarget': str(target), 'qualification': 'Owned junction exercises canonical-vs-input path mismatch; hosted evidence separately establishes actual 8.3 short-name failure.', 'stdoutSha256': hashlib.sha256(result.stdout).hexdigest(), 'stderrSha256': hashlib.sha256(result.stderr).hexdigest()}
(out / 'RESULT.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
raise SystemExit(0 if before == after else 2)
