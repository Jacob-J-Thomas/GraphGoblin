from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

E = Path(__file__).resolve().parent
W = Path(r'G:/ggq/gg-i5-offline-inspector/GraphGoblin')
CORRECTION = E.parent / 'i5-d241-actual-max-residual-correction-01'
FREEZE = E.parent / 'i5-d241-final-correction-freeze-01/FREEZE.json'
PRIOR_CHECKS = E.parent / 'i5-d241-small-followup-checks-01'
AUTHOR_READBACK = E.parent / 'i5-d241-residual-correction-admission-01/AUTHOR-ROOT-READBACK.json'
HEAD = '2231400e7986f349376d7c19ebd62ae71f7708a4'
CORRECTION_PATHS = (
    'CHANGELOG.md',
    'apps/web/src/runs/RunInspectorPage.offline.test.tsx',
    'apps/web/src/runs/RunInspectorPage.tsx',
    'docs/09-frontend-and-pwa.md',
)
PROTECTED = (
    'apps/web/src/api/queries.ts',
    'apps/web/src/runs/inspector-read-provenance.test.ts',
    'apps/web/src/runs/inspector-read-provenance.ts',
)
SELECTION = (
    'src/runs/RunInspectorPage.offline.test.tsx',
    'src/runs/RunInspectorPage.corrective.test.tsx',
    'src/runs/HistoryEligibility.test.tsx',
    'src/runs/recovery-controls.test.tsx',
    'src/runs/RunInspectorPage.test.tsx',
    'src/runs/ScriptRecovery.test.tsx',
    'src/runs/inspector/SessionRecoveryControls.test.tsx',
    'src/runs/inspector/Timeline.test.tsx',
    'src/runs/inspector/WaitPanel.test.tsx',
    'src/api/queries.reconnect.test.tsx',
    'src/runs/inspector-read-provenance.test.ts',
    'src/runs/inspector/ExecutionEvidence.test.tsx',
    'src/runs/inspector/EvaluationDetails.test.tsx',
    'src/runs/RunInspectorPage.lifecycle.test.tsx',
)


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def utc():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def pin(path):
    content = path.read_bytes()
    return {'bytes': len(content), 'sha256': sha256(content).hexdigest()}


def pinned_json(path, expected_sha256):
    require(isinstance(expected_sha256, str) and re.fullmatch(r'[a-f0-9]{64}', expected_sha256),
            f'Missing SHA256 pin for {path.name}')
    data = path.read_bytes()
    require(sha256(data).hexdigest() == expected_sha256, f'Changed bytes at {path}')
    return json.loads(data.decode('utf-8'))


def write(name, data):
    with (E / name).open('x', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def live_head(git_dir, common_dir):
    head = (git_dir / 'HEAD').read_text(encoding='utf-8').strip()
    if not head.startswith('ref: '):
        return head
    ref = head.removeprefix('ref: ')
    require(ref.startswith('refs/heads/') and '..' not in Path(ref).parts, 'Unexpected checkout HEAD reference')
    loose = common_dir / ref
    if loose.is_file():
        return loose.read_text(encoding='utf-8').strip()
    refs = (common_dir / 'packed-refs').read_text(encoding='utf-8').splitlines()
    return next((row.split()[0] for row in refs if row.endswith(' ' + ref)), None)


def check_state(author_paths, git_dir, common_dir, evidence):
    return {
        'authors': {name: pin(W / name) for name in author_paths},
        'selection': {name: pin(W / 'apps/web' / name) for name in SELECTION},
        'controls': {
            'head': live_head(git_dir, common_dir),
            'index': pin(git_dir / 'index'),
            'lock': pin(W / 'pnpm-lock.yaml'),
            'modules': pin(W / 'node_modules/.modules.yaml'),
            'virtualStoreLock': pin(W / 'node_modules/.pnpm/lock.yaml'),
            'core': {name: pin(W / name) for name in PROTECTED},
            'commonIndexPresent': (common_dir / 'index').exists(),
            'closedEvidence': {name: pin(CORRECTION / name) for name in evidence},
        },
    }


def bare_pin(record):
    return {key: record[key] for key in ('bytes', 'sha256')}


def run(label, command, env):
    stdout_path, stderr_path = (E / f'{label}.{stream}' for stream in ('stdout', 'stderr'))
    started = utc()
    with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
        out = subprocess.run(command, cwd=W, env=env, stdout=stdout, stderr=stderr, check=False)
    result = {
        'argv': command, 'cwd': str(W), 'startedUtc': started, 'finishedUtc': utc(),
        'exit': out.returncode, 'stdout': pin(stdout_path), 'stderr': pin(stderr_path),
    }
    write(f'{label}.json', result)
    print(label, out.returncode, flush=True)
    return out.returncode


def test_cases(report):
    files = {}
    for entry in report['testResults']:
        path = Path(entry['name']).resolve().relative_to(W / 'apps/web').as_posix()
        require(path not in files, f'Duplicate Vitest file {path}')
        files[path] = entry['assertionResults']
    return files


def focused_result(exit_code, old_cases, report_path, expected_count):
    if not report_path.is_file():
        return {'exit': exit_code, 'jsonReportPresent': False, 'focusedPassed': False}
    report = read(report_path)
    files = test_cases(report)
    original = {(path, case['fullName']) for path, cases in old_cases.items() for case in cases}
    observed = {(path, case['fullName']) for path, cases in files.items() for case in cases}
    missing = sorted(original - observed)
    rows = [case for cases in files.values() for case in cases]
    failures = [
        {'file': path, 'name': case['fullName'], 'messages': case.get('failureMessages', [])}
        for path, cases in files.items() for case in cases if case['status'] == 'failed'
    ]
    counts = {'total': len(rows), 'passed': sum(case['status'] == 'passed' for case in rows),
              'failed': len(failures)}
    selection_complete = set(files) == set(SELECTION)
    return {'exit': exit_code, 'jsonReportPresent': True, 'report': pin(report_path),
            'testFiles': sorted(files), 'selectionComplete': selection_complete, 'counts': counts,
            'failures': failures, 'priorCaseNamesMissing': missing, 'expectedCaseCount': expected_count,
            'focusedPassed': exit_code == 0 and report['success'] and selection_complete and
                             not missing and counts['passed'] == counts['total'] and counts['total'] == len(observed) == expected_count}


def main():
    binding_path = E / 'BINDING.json'
    require(binding_path.is_file(), 'Root admission and corrected source binding are absent')
    binding = read(binding_path)
    require(len(SELECTION) == len(set(SELECTION)) == 14, 'Unexpected literal test selection')
    require(binding['rootAdmitted'] is True and binding['expectedHead'] == HEAD, 'Root admission is unset')
    freeze = pinned_json(FREEZE, '69724e4c8b75454815957bfe1ac031ddf74fe22727e3dfbe02b36b44253546ae')
    author_readback = pinned_json(AUTHOR_READBACK, 'cd759358756d98fe52fc6536e1b049ddda73f3ab271ae070f025920a4c2db661')
    expected_count = binding['expectedTestCount']
    require(type(expected_count) is int and expected_count == author_readback['expectedFocusedCases'] == 229
            and author_readback['preservedExistingCases'] == 227, 'Root must bind the actual 227 + 2 test roster')
    paths = list(freeze['files'])
    lint_paths = [name for name in paths if name.endswith(('.ts', '.tsx'))]
    require(len(paths) == 15 and len(lint_paths) == 13 and not set(paths) & set(PROTECTED), 'Unexpected static scope')
    correction_pins = binding['correctedAuthorFiles']
    require(isinstance(correction_pins, dict) and correction_pins.keys() == freeze['files'].keys(),
            'Root must supply corrected bytes for all 15 paths')
    require(all((W / name).resolve(strict=True) == W / name for name in paths), 'Unexpected redirected author path')
    evidence = binding['closedEvidenceSha256']
    require(set(evidence) == {'source-after.json', 'process.json', 'terminal.json', 'ordinary-handoff.md'},
            'Incomplete correction closure binding')
    for name, wanted in evidence.items():
        require(pin(CORRECTION / name)['sha256'] == wanted, f'Changed correction evidence {name}')
    closure = read(CORRECTION / 'source-after.json')
    process = read(CORRECTION / 'process.json')
    require(closure['sourceAndControlsVerified'] is True and closure['closureUncertainAtReadback'] is False,
            'Correction source/control closure is unverified')
    require(process['directChildReaped'] and process['streamReadersFinished'] and
            not process['timeout'] and process['originalFailure'] is None,
            'Correction process closure is unverified')
    source = closure['snapshot']
    require(source['source'] == freeze['source'] and source['source']['head'] == HEAD, 'Unexpected correction base')
    differences = sorted(name for name in paths if correction_pins[name] != freeze['files'][name])
    require(differences == list(CORRECTION_PATHS) == sorted(closure['changedPaths'])
            == sorted(binding['correctionPaths']) == sorted(author_readback['changedPaths']),
            'Visible correction paths disagree with the four-path residual scope or root binding')
    previous = pinned_json(PRIOR_CHECKS / 'AFTER.json', '98afb237af648b2eef0874768685a7a98ebf3987cb63e57109b6ad16946018fc')
    require(previous['authors'] == freeze['files'] and previous['controls']['core'] == freeze['protectedCore'],
            'Prior checked bytes disagree with the 223 freeze')
    baseline_test_pins = previous['selection']
    require(set(baseline_test_pins) == set(SELECTION), 'Unexpected baseline test pins')
    require(all((W / 'apps/web' / path).resolve(strict=True) == W / 'apps/web' / path for path in SELECTION),
            'A literal test path is missing or redirected')
    prior_report = pinned_json(PRIOR_CHECKS / 'vitest-results.json', '615f3142a84b4143611580693adb091608e2adebe86951a936d2f2e4bfac483')
    old_cases = test_cases(prior_report)
    old_rows = [(name, case['fullName']) for name, cases in old_cases.items() for case in cases]
    require(prior_report['success'] is True and set(old_cases) == set(SELECTION)
            and len(old_rows) == len(set(old_rows)) == 227, 'Unexpected prior accepted test roster')
    git_dir_line = (W / '.git').read_text(encoding='utf-8').strip()
    require(git_dir_line.startswith('gitdir: '), 'Expected linked checkout')
    git_dir = (W / git_dir_line.removeprefix('gitdir: ')).resolve(strict=True)
    common_dir = (git_dir / (git_dir / 'commondir').read_text(encoding='utf-8').strip()).resolve(strict=True)
    require(Path(source['index']['source']) == git_dir / 'index', 'Correction index belongs to a different checkout')
    before = check_state(paths, git_dir, common_dir, evidence)
    controls = before['controls']
    require(controls['head'] == HEAD and not controls['commonIndexPresent'], 'Checkout or common index changed')
    require(before['authors'] == correction_pins, 'Worktree bytes differ from root-bound correction')
    for role in ('index', 'lock', 'modules'):
        require(controls[role] == bare_pin(source[role]), f'{role} differs from correction closure')
    require(controls['index'] == bare_pin(freeze['index']), 'Index differs from the 223 freeze')
    for name in ('lock', 'modules', 'virtualStoreLock', 'core'):
        require(controls[name] == previous['controls'][name], f'{name} differs from the prior accepted D241 check')
    require(controls['core'] == {name: bare_pin(source['core'][name]) for name in PROTECTED}, 'Protected core differs from closure')
    for name in SELECTION:
        author_name = 'apps/web/' + name
        expected = correction_pins.get(author_name, baseline_test_pins[name])
        require(before['selection'][name] == expected, f'Unexpected test bytes at {name}')
    write('BEFORE.json', before | {'expectedAuthorCorrections': differences, 'rootBinding': pin(binding_path),
                                   'initialFreeze': pin(FREEZE), 'priorAcceptedTestReport': pin(PRIOR_CHECKS / 'vitest-results.json')})

    node_dir = Path(os.environ['USERPROFILE']) / '.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64'
    env = os.environ | {'PATH': str(node_dir) + os.pathsep + os.environ['PATH']}
    node_exe = shutil.which('node.exe', path=env['PATH'])
    pnpm_exec = shutil.which('pnpm.cmd', path=env['PATH'])
    require(node_exe and Path(node_exe).resolve() == (node_dir / 'node.exe').resolve() and pnpm_exec,
            'Whole-shell Node or pnpm selection is invalid')
    write('RUNTIME.json', {'nodePath': node_exe, 'pnpmPath': pnpm_exec})
    def pnpm(label, *args):
        command = [os.environ['COMSPEC'], '/d', '/s', '/c', subprocess.list2cmdline(['pnpm.cmd', *args])]
        return run(label, command, env)
    require(run('00-node', [node_exe, '--version'], env) == 0 and pnpm('00-pnpm', '--version') == 0,
            'Unable to verify command runtime')
    require((E / '00-node.stdout').read_text(encoding='utf-8').strip() == 'v22.23.4' and
            (E / '00-pnpm.stdout').read_text(encoding='utf-8').strip() == '12.8.1', 'Unexpected Node or pnpm version')

    typecheck = pnpm('01-typecheck', '--filter', '@graphgoblin/web', 'run', 'typecheck')
    lint = pnpm('02-eslint', 'exec', 'eslint', *lint_paths)
    check = pnpm('03-prettier-check', 'exec', 'prettier', '--check', *paths)
    static = check_state(paths, git_dir, common_dir, evidence)
    write('AFTER-STATIC.json', static)
    summary = {'webTypecheckExit': typecheck, 'scopedEslintExit': lint, 'prettierCheckExit': check,
               'expectedAuthorCorrections': differences, 'formattingWriteInvoked': False,
               'initialStaticSourceAndControlsUnchanged': static == before}
    if (typecheck == lint == 0 and check == 1 and static == before
            and binding.get('allowScopedFormatting') is True):
        diagnostics = (E / '03-prettier-check.stderr').read_text(encoding='utf-8')
        if 'Code style issues found' in diagnostics and '[error]' not in diagnostics:
            saved = E / 'before-format'
            saved.mkdir()
            for name in differences:
                saved_copy = saved / name
                saved_copy.parent.mkdir(parents=True, exist_ok=True)
                with saved_copy.open('xb') as stream:
                    stream.write((W / name).read_bytes())
                require(pin(saved_copy) == before['authors'][name], f'Before-format copy differs at {name}')
            formatted = pnpm('04-prettier-write', 'exec', 'prettier', '--write', *differences)
            after_format = check_state(paths, git_dir, common_dir, evidence)
            format_delta = sorted(name for name in paths if after_format['authors'][name] != before['authors'][name])
            unchanged_other_tests = all(after_format['selection'][name] == before['selection'][name]
                                        for name in SELECTION if 'apps/web/' + name not in differences)
            format_scope_ok = (set(format_delta) <= set(differences) and unchanged_other_tests
                               and after_format['controls'] == before['controls'])
            write('FORMAT-DELTA.json', {'before': before, 'after': after_format, 'changedPaths': format_delta,
                                        'onlyAdmittedPathsChanged': format_scope_ok})
            summary |= {'formattingWriteInvoked': True, 'prettierWriteExit': formatted,
                        'formatScopeVerified': format_scope_ok}
            if formatted == 0 and format_scope_ok:
                check = pnpm('05-prettier-recheck', 'exec', 'prettier', '--check', *paths)
                static = check_state(paths, git_dir, common_dir, evidence)
                write('AFTER-FORMAT-RECHECK.json', static)
                summary |= {'prettierRecheckExit': check, 'postFormatRecheckUnchanged': static == after_format}
    if summary['formattingWriteInvoked']:
        static_passed = (summary['prettierWriteExit'] == 0 and summary['formatScopeVerified']
                         and summary.get('prettierRecheckExit') == 0 and summary.get('postFormatRecheckUnchanged') is True)
    else:
        static_passed = typecheck == lint == check == 0 and static == before
    summary['staticPassed'] = static_passed
    if not static_passed:
        write('RESULT.json', summary | {'focusedInvoked': False})
        return 1

    report_path = E / 'vitest-results.json'
    require(not report_path.exists(), 'Focused report path already exists')
    code = pnpm('06-focused', '--filter', '@graphgoblin/web', 'exec', 'vitest', 'run', *SELECTION,
                '--maxWorkers=1', '--retry=0', '--reporter=verbose', '--reporter=json',
                '--outputFile.json=' + report_path.as_posix())
    after = check_state(paths, git_dir, common_dir, evidence)
    write('AFTER.json', after)
    focus = focused_result(code, old_cases, report_path, expected_count)
    write('RESULT.json', summary | {'focusedInvoked': True, 'focused': focus,
                                    'focusedSourceAndControlsUnchanged': static == after})
    return 0 if focus['focusedPassed'] and static == after else 1


if __name__ == '__main__':
    sys.exit(main())
