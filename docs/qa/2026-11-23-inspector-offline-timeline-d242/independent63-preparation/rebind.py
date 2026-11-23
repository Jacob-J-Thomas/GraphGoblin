"""Advance the exact D241 UIQA checkout once and bind the unchanged D242 component run."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import traceback

P = Path(__file__).resolve().parent
E = P.parent
W = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
REBIND = E / 'i5-d242-b2-independent63-rebind-01'
RUN = E / 'i5-d242-b2-independent63-execution-01'
GIT = Path('C:/Program Files/Git/cmd/git.exe')
ENV = {k: v for k, v in os.environ.items() if not k.upper().startswith('GIT_')}
ENV.update(GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1', GIT_TERMINAL_PROMPT='0')


def need(value, message):
    if not value:
        raise RuntimeError(message)


def digest(data):
    return sha256(data).hexdigest()


def pin(path):
    raw = path.read_bytes()
    return {'bytes': len(raw), 'sha256': digest(raw)}


def reference(path):
    return {'source': str(path), **pin(path)}


def read(path):
    return json.loads(path.read_bytes())


def save(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def copy_bytes(path, raw):
    with path.open('xb') as stream:
        stream.write(raw)


def checked_ref(ref):
    path = Path(ref['source'])
    need(path.is_absolute() and path == path.resolve(strict=True) and path.is_relative_to(E)
         and path.is_file() and reference(path) == ref, 'Public evidence reference mismatch')
    return path


def git(*args):
    return subprocess.check_output([str(GIT), '--no-optional-locks', '-C', str(W), *args],
                                   env=ENV, stderr=subprocess.PIPE, timeout=180)


def git_text(*args):
    return git(*args).decode('utf-8').strip()


def git_list(*args):
    raw = git(*args)
    return raw.decode('utf-8').split('\0')[:-1]


def utc():
    return datetime.now(timezone.utc).isoformat()


def prepare_context(root_manifest_sha256):
    manifest = P / 'MANIFEST.json'
    need(pin(manifest)['sha256'] == root_manifest_sha256, 'Root preparation manifest mismatch')
    for row in read(manifest)['members']:
        need(pin(P / row['path']) == {k: row[k] for k in ('bytes', 'sha256')}, row['path'])
    fixed = read(P / 'FIXED-CONTROLS.json')
    for ref in fixed['references'].values():
        checked_ref(ref)
    need(reference(GIT) == fixed['gitBinary'], 'Pinned Git binary differs')
    return fixed


def verify_distributions(fixed):
    manifest = read(checked_ref(fixed['references']['frozenBuild']))
    expected = manifest['webDist']
    need(len(expected) == 28 and manifest['source']['head'] == fixed['baseline']['head'],
         'Legacy distribution manifest differs')
    result = {}
    for label, path in [('ownedLegacy', Path(fixed['oldOwnedDist'])), ('workingWebDist', W / 'apps/web/dist')]:
        need(path.is_dir() and path.resolve(strict=True) == path, f'Expected exact {label} directory')
        actual = {p.relative_to(path).as_posix(): pin(p) for p in path.rglob('*') if p.is_file()}
        need(actual == expected, f'Frozen web distribution differs: {label}')
        result[label] = {'directory': str(path), 'files': actual}
    return result


def snapshot(fixed, template):
    need(Path(git_text('rev-parse', '--show-toplevel')).resolve() == W, 'Wrong checkout')
    index = Path(git_text('rev-parse', '--path-format=absolute', '--git-path', 'index')).resolve()
    common = Path(git_text('rev-parse', '--path-format=absolute', '--git-common-dir')).resolve()
    merge_head = Path(git_text('rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD'))
    need(str(index) == fixed['indexPath'] and (common / 'worktrees') in index.parents
         and not os.path.lexists(common / 'index') and not os.path.lexists(merge_head), 'Unexpected index/merge state')
    source = {'head': git_text('rev-parse', 'HEAD'), 'tree': git_text('rev-parse', 'HEAD^{tree}'),
              'indexSha256': pin(index)['sha256'],
              'stagedEntriesSha256': digest(git('ls-files', '--stage', '-z')), 'commonIndexExists': False,
              'status': git_list('status', '--porcelain=v1', '--untracked-files=all', '-z'),
              'selectedSources': {name: pin(W / name)['sha256'] for name in template['source']['selectedSources']}}
    controls = {'source': source, 'index': reference(index), 'protectedConfigs': {},
                'protectedCore': {name: pin(W / name) for name in fixed['protectedCore']}}
    for field in ('rootInstallInputs19', 'independentInputs18', 'metadata', 'overlays'):
        values = {name: pin(W / name) for name in template[field]}
        controls[field] = values if field == 'rootInstallInputs19' else {
            name: record['sha256'] for name, record in values.items()}
        need(controls[field] == template[field], f'Protected cohort differs: {field}')
    controls['protectedConfigs'] = {name: pin(W / name) for name in fixed['protectedConfigs']}
    need(controls['protectedCore'] == fixed['protectedCore'], 'Protected core file differs')
    need(pin(Path(template['runtime']['node']['path']))['sha256'] == template['runtime']['node']['sha256'],
         'Pinned Node binary differs')
    for path_field, hash_field in [('pnpmLauncher','launcherSha256'), ('pnpmExecutable','executableSha256'),
                                  ('packagePath','packageSha256')]:
        pnpm = template['runtime']['pnpm']
        need(pin(Path(pnpm[path_field]))['sha256'] == pnpm[hash_field], 'Pinned pnpm identity differs')
    for module in template['selectedModules']:
        entry = Path(module['entry'])
        need(entry.resolve(strict=True) == Path(module['realEntry']).resolve(strict=True)
             and pin(entry)['sha256'] == module['entrySha256'], f"Module entry differs: {module['name']}")
        if 'manifest' in module:
            need(pin(Path(module['manifest']))['sha256'] == module['manifestSha256'],
                 f"Module manifest differs: {module['name']}")
    for diff in (('diff', '--exit-code'), ('diff', '--cached', '--exit-code')):
        need(not git(*diff, '--no-ext-diff', '--no-textconv'), 'Tracked or staged diff present')
    controls['distributions'] = verify_distributions(fixed)
    return controls


def record_index(snapshot_value, name):
    path = Path(snapshot_value['index']['source'])
    destination = REBIND / name
    copy_bytes(destination, path.read_bytes())
    need(pin(destination) == pin(path), 'Raw index copy drift')
    return reference(destination)


def advance():
    admission_path = P / 'ROOT-FF-ADMISSION.json'
    need(admission_path.is_file(), 'UNARMED: actual root fast-forward admission is absent')
    admission = read(admission_path)
    need(admission['ffAdmitted'] is True and admission['executionAdmitted'] is False
         and admission['originalUiqaIndexReleasedByRoot'] is True, 'UNARMED: no root UIQA-advance admission')
    fixed = prepare_context(admission['preparationManifestSha256'])
    template = read(P / 'ROOT-BINDING.template.json')
    freeze = read(checked_ref(admission['freezeReceipt']))
    checked_ref(admission['focusedReceipt'])
    checked_ref(admission['oldNativeDisposition'])
    source = admission['source']
    need(freeze['source'] == source and set(source) == {'head','tree','parents'} and
         isinstance(source['parents'], list) and bool(source['parents']) and
         all(isinstance(v, str) and re.fullmatch(r'[0-9a-f]{40}',v)
             for v in [source['head'],source['tree'],*source['parents']]), 'Root freeze identity differs')
    baseline, held = fixed['baseline']['head'], fixed['heldSource']['head']
    head = source['head']
    need(head not in (baseline, held) and not REBIND.exists() and not RUN.exists(), 'Fresh rebind and run required')
    before = snapshot(fixed, template)
    for key, old in fixed['baseline'].items():
        if key == 'selectedSources':
            need(all(before['source']['selectedSources'][name] == old_sha for name, old_sha in old.items()),
                 'Original selected materialized source differs')
        else:
            need(before['source'][key] == old, f'Original protected UIQA identity differs: {key}')
    need(before['protectedConfigs'] == fixed['protectedConfigs'], 'Baseline config pins differ')
    need(git_text('show', '-s', '--format=%P', held).split() == [baseline] and
         git_text('rev-parse', held+'^{tree}') == fixed['heldSource']['tree'], 'Held archive ancestry differs')
    need(git_text('merge-base', held, head) == held and not git_text('rev-list','--merges',f'{held}..{head}'),
         'Correction is outside the linear held source history')
    need(git_text('show','-s','--format=%P',head).split() == source['parents']
         and git_text('rev-parse',head+'^{tree}') == source['tree'], 'Exact corrected object differs')
    flags = ('diff', '--no-ext-diff', '--no-textconv', '--no-renames')
    archive = checked_ref(fixed['references']['archivePaths']).read_bytes().decode('utf-8-sig').split('\0')[:-1]
    need(len(archive) == len(set(archive)) == 1431 and
         set(git_list(*flags, '--name-only','-z',baseline,held)) == set(archive), 'Exact prior archive delta differs')
    correction = set(git_list(*flags,'--name-only','-z',held,head))
    expected_files = admission['correctedFiles']
    need(bool(correction) and correction == set(expected_files) and
         correction <= set(fixed['correctionPaths']), 'Corrected source escaped its exact eight-path envelope')
    for name, expected in expected_files.items():
        raw = git('cat-file','blob',head+':'+name)
        need({'bytes':len(raw),'sha256':digest(raw)} == expected, f'Corrected Git blob pin differs: {name}')
    need(not git('ls-tree','-r','--name-only',head,'--',*template['overlays']), 'Overlay would become tracked')
    new_selected = dict(before['source']['selectedSources'])
    for name in correction & set(new_selected):
        new_selected[name] = expected_files[name]['sha256']
    patched_attrs = git('cat-file','blob',held+':.gitattributes')
    expected_config = fixed['protectedConfigs'] | {
        '.gitattributes': {'bytes':len(patched_attrs),'sha256':digest(patched_attrs)}}

    REBIND.mkdir(exist_ok=False)
    try:
        save(REBIND / 'before.json', before)
        original_index = record_index(before, 'before-index.raw')
        overlays = REBIND / 'overlays-before'
        overlays.mkdir()
        for name, want in template['overlays'].items():
            duplicate = overlays / Path(name).name
            copy_bytes(duplicate, (W / name).read_bytes())
            need(pin(duplicate)['sha256'] == want, f'Original overlay copy differs: {name}')
        copy_bytes(REBIND / 'correction.diff', git(*flags,'--binary','--full-index',held,head))
        copy_bytes(REBIND / 'root-ff-admission.json', admission_path.read_bytes())
        argv = [str(GIT), '--no-optional-locks', '-C', str(W), 'merge', '--ff-only', head]
        started = utc()
        with (REBIND/'ff-only.stdout.log').open('xb') as out, (REBIND/'ff-only.stderr.log').open('xb') as err:
            result = subprocess.run(argv, env=ENV, stdout=out, stderr=err, check=False, timeout=180)
        save(REBIND/'FF-ONLY.receipt.json', {'argv':argv,'startedUtc':started,'finishedUtc':utc(),
             'exitCode':result.returncode,'stdout':reference(REBIND/'ff-only.stdout.log'),
             'stderr':reference(REBIND/'ff-only.stderr.log'),'rootAdmission':reference(admission_path)})
        need(result.returncode == 0, 'Fast-forward stopped; preserve the first failure')
        after = snapshot(fixed, template)
        save(REBIND / 'after.json', after)
        corrected_index = record_index(after, 'after-index.raw')
        need(after['source']['head'] == head and after['source']['tree'] == source['tree'] and
             after['source']['status'] == before['source']['status'] and
             after['source']['selectedSources'] == new_selected, 'Corrected checkout parity differs')
        need(after['protectedConfigs'] == expected_config, 'Only the explicit prior archive attribute may differ')
        need(after['distributions'] == before['distributions'], 'Existing distributions changed')
        for name, expected in expected_files.items():
            need(pin(W / name) == expected, f'Corrected materialized file differs: {name}')
        for name in template['overlays']:
            need((W / name).read_bytes() == (overlays / Path(name).name).read_bytes(),
                 f'Actual overlay bytes differ: {name}')
        template['source'] = after['source']
        template['preparationManifestSha256'] = admission['preparationManifestSha256']
        binding = REBIND / 'ROOT-BINDING.unarmed.json'
        save(binding, template)
        save(REBIND/'REBIND.json', {'utc':utc(),'source':source,'beforeIndex':before['index'],
             'afterIndex':after['index'],'rawIndexBefore':original_index,'rawIndexAfter':corrected_index,
             'stagedEntriesSha256':after['source']['stagedEntriesSha256'],'allFiveOverlaysUnchanged':True,
             'afterSnapshot':reference(REBIND/'after.json'),
             'legacyDistributionPreserved':True,'commonIndexAbsent':True,'archivePathsVerified':len(archive),
             'correctionPaths':sorted(correction),'freezeReceipt':admission['freezeReceipt'],
             'executionAdmitted':False,'unarmedBinding':reference(binding)})
        print(str(REBIND/'REBIND.json'))
    except BaseException:
        (REBIND / 'FAILURE.txt').write_text(traceback.format_exc(),encoding='utf-8')
        raise


def bind_execution():
    path = P/'ROOT-EXECUTION-ADMISSION.json'
    need(path.is_file(), 'UNARMED: actual root component execution admission is absent')
    admission = read(path)
    need(admission['executionAdmitted'] is True and admission['soleHeavySlotAssigned'] is True,
         'UNARMED: component execution and slot are unset')
    fixed = prepare_context(admission['preparationManifestSha256'])
    rebind_path = checked_ref(admission['rebind'])
    need(rebind_path == REBIND/'REBIND.json' and not RUN.exists(), 'Fresh execution directory required')
    rebind = read(rebind_path)
    need(rebind['source'] == admission['source'] and rebind['executionAdmitted'] is False,
         'Rebind source mismatch')
    unarmed = checked_ref(rebind['unarmedBinding'])
    binding = read(unarmed)
    after_snapshot = checked_ref(rebind['afterSnapshot'])
    current = snapshot(fixed,binding)
    need(after_snapshot == REBIND/'after.json' and current == read(after_snapshot)
         and binding['executionAdmitted'] is False and binding['source'] == current['source']
         and current['index'] == rebind['afterIndex'], 'Post-advance source or control drift')
    binding['executionAdmitted'] = True
    binding['rootAdmission'] = {'path':str(path),'sha256':pin(path)['sha256']}
    binding['rootInstructions'] = 'Run only the unchanged D241 fresh2 then separate full63 component regression.'
    output = REBIND/'ROOT-BINDING.admitted.json'
    save(output,binding)
    print(json.dumps(reference(output)))


if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['--root-execute-ff']:
        advance()
    elif args == ['--root-bind-execution']:
        bind_execution()
    else:
        raise SystemExit('UNARMED: supply an explicit root-authorized phase')
