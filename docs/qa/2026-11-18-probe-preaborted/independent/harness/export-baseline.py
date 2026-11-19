from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from tarfile import open as open_tar
import json
import subprocess

packet = Path(__file__).resolve().parent
scratch = Path('D:/GraphGoblin-QA/2026-11-18/pr505-preaborted-independent-qa')
source = scratch / 'source-baseline'
git_root = Path('C:/Users/98jak/source/repos/GraphGoblin')
dependency_root = Path('C:/Users/98jak/.codex/worktrees/gg-20261117-probe-466/GraphGoblin')
commit = '0ff00d6717bfb397e42bf85db8fe62ed1fc0d9b7'
if source.exists(): raise ValueError('Baseline export already exists')
source.mkdir(parents=True)
paths = ['packages', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc', 'tsconfig.base.json', 'tooling/package.json', 'tooling/vitest.shared.mjs']
archive = subprocess.check_output(['git', '-C', str(git_root), 'archive', '--format=tar', commit, *paths])
files = []
with open_tar(fileobj=BytesIO(archive), mode='r:') as tar:
    for member in tar:
        name = PurePosixPath(member.name)
        if name.is_absolute() or '..' in name.parts or '\\' in member.name: raise ValueError('Unsafe export path')
        target = source / Path(*name.parts)
        if member.isdir(): target.mkdir(parents=True, exist_ok=True)
        elif member.isfile():
            raw = tar.extractfile(member).read()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            files.append({'path': member.name, 'bytes': len(raw), 'sha256': sha256(raw).hexdigest()})
        else: raise ValueError('Non-regular tracked export entry ' + member.name)
test = source / 'packages/adapter-codex/src/probe-directory.test.ts'
fixture = source / 'packages/adapter-codex/src/fixtures/readiness-cli.mjs'
(packet / 'baseline-probe-directory.test.ts.txt').write_bytes(test.read_bytes())
aliases = []
for package_file in source.glob('packages/*/package.json'):
    package = json.loads(package_file.read_bytes())
    for export, conditions in package.get('exports', {}).items():
        if isinstance(conditions, dict) and isinstance(conditions.get('development'), str):
            public = package['name'] + ('' if export == '.' else export[1:])
            aliases.append({'find': public, 'replacement': str(package_file.parent / conditions['development']).replace('\\', '/')})
aliases.sort(key=lambda item: len(item['find']), reverse=True)
aliases.insert(0, {'find': 'vitest', 'replacement': str(dependency_root / 'packages/adapter-codex/node_modules/vitest/dist/index.js').replace('\\', '/')})
result = {
    'commit': commit, 'sourceRoot': str(source), 'scratchRoot': str(scratch), 'dependencyRoot': str(dependency_root),
    'sourceTestSha256': sha256(test.read_bytes()).hexdigest(), 'fixtureSha256': sha256(fixture.read_bytes()).hexdigest(),
    'vitestVersion': json.loads((dependency_root / 'packages/adapter-codex/node_modules/vitest/package.json').read_bytes())['version'],
    'baselineLockSha256': sha256((source / 'pnpm-lock.yaml').read_bytes()).hexdigest(),
    'existingDependencyLockSha256': sha256((dependency_root / 'pnpm-lock.yaml').read_bytes()).hexdigest(),
    'aliases': aliases, 'files': files,
}
(packet / 'baseline-binding.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: result[key] for key in ('commit', 'sourceRoot', 'sourceTestSha256', 'fixtureSha256', 'vitestVersion', 'baselineLockSha256', 'existingDependencyLockSha256')}, indent=2))
