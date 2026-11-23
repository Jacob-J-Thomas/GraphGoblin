import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

directory = Path(__file__).parent
root = Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin')
baseline_path = directory.parent / 'i5-416-420-review-reproduction-01/old/after.json'
baseline = json.loads(baseline_path.read_text(encoding='utf-8'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*arguments):
    return subprocess.check_output(
        ['git', '--no-optional-locks', *arguments], cwd=root,
        env=dict(os.environ, GIT_OPTIONAL_LOCKS='0'))


index = Path(git('rev-parse', '--path-format=absolute', '--git-path', 'index').decode().strip())
common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir').decode().strip())
pins = {
    'head': git('rev-parse', 'HEAD').decode().strip(),
    'tree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
    'indexSha256': sha(index.read_bytes()),
    'stagedEntriesSha256': sha(git('ls-files', '--stage', '-z')),
    'commonIndexExists': (common / 'index').exists(),
    'status': git('status', '--porcelain=v1', '--untracked-files=all', '-z').decode().split('\0')[:-1],
}
for group in ['dependencyInputs', 'metadata', 'selectedSources', 'overlays']:
    pins[group] = {path: sha((root / path).read_bytes()) for path in baseline[group]}
matches = {key: value == baseline[key] for key, value in pins.items()}
assert all(matches.values()), matches
original = (directory / 'independent-420-geometry.original.ts').read_text(encoding='utf-8')
proposed = (directory / 'independent-420-geometry.proposed.ts').read_text(encoding='utf-8')
restored = proposed.replace('  await page.evaluate(() => document.fonts.ready.then(() => undefined));\n', '')
restored = re.sub(
    r'  const culprits = await page\.evaluate\(\(\) => \{[\s\S]*?\n  \}\);\n(?=  const measurement = \{)',
    '', restored)
restored = restored.replace('    culprits,\n', '')
assert restored == original, 'Existing helper text changed after formatting'
checks = {
    'selectedBaselinePath': str(baseline_path),
    'selectedBaselineSha256': sha(baseline_path.read_bytes()),
    'allSelectedPinsUnchanged': all(matches.values()),
    'selectedComparisons': matches,
    'existingHelperTextPreservedAfterRemovingOnlyDiagnostics': True,
    'currentHelperOriginalCopyByteIdentical': (
        (root / 'apps/web/e2e/independent-420-geometry.ts').read_bytes()
        == (directory / 'independent-420-geometry.original.ts').read_bytes()),
    'proposedSha256': sha((directory / 'independent-420-geometry.proposed.ts').read_bytes()),
    'scope': 'Read-only selected pins; no exhaustive module/source inventory or product/browser execution.',
    'pins': pins,
}
assert checks['currentHelperOriginalCopyByteIdentical']
(directory / 'BINDING.json').write_text(json.dumps(checks, indent=2) + '\n', encoding='utf-8')
(directory / 'geometry-diagnostics.diff').write_text(''.join(difflib.unified_diff(
    original.splitlines(keepends=True), proposed.splitlines(keepends=True),
    fromfile='current/independent-420-geometry.ts', tofile='proposed/independent-420-geometry.ts')),
    encoding='utf-8')
print(json.dumps({key: value for key, value in checks.items() if key != 'pins'}, indent=2))
