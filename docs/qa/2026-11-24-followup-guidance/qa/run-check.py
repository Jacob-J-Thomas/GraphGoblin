"""Run independent disposable checks on the frozen GraphGoblin guidance candidate."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

QA = Path(__file__).resolve().parent
WORKTREE = Path('G:/ggq/gg-fu-guidance-20261124/GraphGoblin')
NODE = Path('C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64')
BASH = Path('C:/Program Files/Git/bin/bash.exe')
SUBSCRIPTION_KEYS = frozenset(
    'systemroot windir comspec path pathext processor_architecture number_of_processors'.split()
)
CANARY = 'GG-INDEPENDENT-QA-SYNTHETIC-JEV-20261124'
FIXTURE = QA / 'fixture'
RUNTIME = QA / 'WindowsCredentialQa.exe'
DRIVER = QA / 'WindowsCredentialQa.cs'
LAUNCHER = 'apps/windows-launcher/Launcher.cs'
EXPECTED_NATIVE = (
    'validConfigAccepts', 'processJevMatchesScenario', 'childEnvironmentJevMatchesScenario',
    'gatewayEnvironmentJevMatchesScenario', 'gatewayProcessJevMatchesScenario',
    'bothMapsStripInheritedGgCredentialNames', 'gatewayProcessStripsInheritedGgCredentialNames',
    'persistedMasterCanonicalEmptyRefused', 'persistedMasterMixedCaseEmptyRefused',
    'persistedJevCanonicalEmptyRefused', 'persistedJevMixedCaseEmptyRefused',
)
DOC_FILES = (
    'CHANGELOG.md', 'apps/plugin-codex/plugin/graphgoblin/skills/run-loop/SKILL.md',
    'docs/09-frontend-and-pwa.md', 'docs/guide/05-mcp-and-codex-plugin.md',
    'docs/guide/06-settings-and-secrets.md', 'docs/guide/08-offline-upgrade.md',
)
COMMANDS = {
    'mcp': 'pnpm.cmd --filter @graphgoblin/mcp exec vitest run src/loop-names.test.ts src/mcp.test.ts -t "loop lookup|controlled inconsistent|lists and describes loops"',
    'plugin': 'pnpm.cmd --filter @graphgoblin/plugin-claude exec vitest run src/plugin.test.ts',
    'seed': 'pnpm.cmd --filter @graphgoblin/api exec vitest run src/container.test.ts src/units.test.ts -t "Jev key at boot|resolves the Jev environment seed"',
    'reset': 'pnpm.cmd --filter @graphgoblin/api exec vitest run src/reset/reset-ownership.test.ts -t "the locks a dry run|already gone when it took a lock|refusal after taking the locks|names the stale locks and guards it reclaimed"',
    'docs': 'pnpm.cmd exec node tooling/scripts/gen-docs.mjs --check',
    'format': 'pnpm.cmd exec prettier --check ' + ' '.join(DOC_FILES),
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

def test_environment():
    env = {k: v for k, v in os.environ.items() if k.casefold() in SUBSCRIPTION_KEYS}
    env['PATH'] = str(NODE) + ';' + env.pop('Path', env.get('PATH', ''))
    # Vitest fixtures and compiler scratch live in this owned evidence area.
    temp = FIXTURE / 'temp'
    temp.mkdir(parents=True, exist_ok=True)
    env['TEMP'] = env['TMP'] = str(temp)
    return env

def run(args, env, cwd=QA, timeout=90):
    return subprocess.run(args, env=env, cwd=cwd, timeout=timeout, capture_output=True,
                          text=True, encoding='utf-8', errors='replace',
                          creationflags=subprocess.CREATE_NO_WINDOW)

def native(env):
    if not DRIVER.is_file() or DRIVER.resolve() != DRIVER:
        raise RuntimeError('Expected an ordinary WindowsCredentialQa.cs in the evidence directory')
    launcher = WORKTREE / LAUNCHER
    pre_sha = sha(launcher)
    result = run(
        [str(Path(env['SYSTEMROOT']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
         '/nologo', '/target:exe', '/main:WindowsCredentialQa',
         '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
         '/out:' + str(RUNTIME), str(launcher), str(DRIVER)],
        env, timeout=40,
    )
    if result.returncode != 0:
        print(result.stdout + result.stderr)
        return result.returncode
    with_canary = {
        **env, 'JEV_API_KEY': CANARY, 'GG_JEV_API_KEY': 'QA-SYNTHETIC-GG-JEV',
        'GG_MASTER_KEY': 'QA-SYNTHETIC-GG-MASTER',
    }
    without_canary = {k: v for k, v in with_canary.items() if k != 'JEV_API_KEY'}
    reports = {}
    exits = {}
    for scenario, child_env in (('inherit', with_canary), ('removed', without_canary)):
        completed = run(
            [str(RUNTIME), scenario, str(FIXTURE), str(NODE / 'node.exe')],
            child_env, timeout=14,
        )
        try:
            output = json.loads(completed.stdout)
        except json.JSONDecodeError:
            output = {}
        # This projection deliberately discards all child output other than assertion booleans.
        reports[scenario] = {
            key: output.get(key) is True for key in EXPECTED_NATIVE
        } if isinstance(output, dict) else dict.fromkeys(EXPECTED_NATIVE, False)
        exits[scenario] = completed.returncode
    receipt = {
        'compilerExit': result.returncode, 'windowsNative': True,
        'launcherSource': LAUNCHER, 'launcherSha256': pre_sha,
        'launcherSourceStable': sha(launcher) == pre_sha,
        'driverSha256': sha(DRIVER), 'executableSha256': sha(RUNTIME),
        'processExitCodes': exits, 'assertionsByScenario': reports,
        'environmentDifference': ['JEV_API_KEY'],
    }
    receipt['passed'] = (receipt['launcherSourceStable'] and all(exit == 0 for exit in exits.values())
                         and all(value for cases in reports.values() for value in cases.values()))
    save(QA / 'WINDOWS-NATIVE-RESULT.json', receipt)
    print(json.dumps(receipt, indent=2))
    return int(not receipt['passed'])

def main():
    if len(sys.argv) != 2 or sys.argv[1] not in (*COMMANDS, 'native'):
        raise SystemExit('Choose one of the explicitly supported independent QA checks.')
    name = sys.argv[1]
    env = test_environment()
    if name == 'native':
        return native(env)
    result = run([str(BASH), '--noprofile', '--norc', '-c',
                  'node --version && ' + COMMANDS[name]], env, WORKTREE, timeout=110)
    combined = (result.stdout + result.stderr).encode('utf-8')
    # These maintained checks use their own controlled fixtures and sanitized inputs.
    # Still, omit their raw logs from the public receipt.
    log = QA / f'CHECK-{name}.private.log'
    log.write_bytes(combined)
    save(QA / f'CHECK-{name}.json', {
        'role': 'independent QA', 'check': name, 'command': COMMANDS[name],
        'exitCode': result.returncode, 'logSha256': sha(log),
    })
    sys.stdout.buffer.write(combined)
    return result.returncode

if __name__ == '__main__':
    sys.exit(main())



