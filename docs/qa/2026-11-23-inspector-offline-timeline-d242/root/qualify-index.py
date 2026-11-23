from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess

P = Path(__file__).resolve().parent
D = P.parent / 'i5-d242-index-drift-readback-01'
W = Path('G:/ggq/gg-i5-offline-inspector/GraphGoblin')
index = Path('G:/ggq/gg-delivery-next-independent/GraphGoblin/.git/worktrees/GraphGoblin10/index')
def pin(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': sha256(data).hexdigest()}
def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

manifest = D / 'MANIFEST.json'
assert pin(manifest)['sha256'] == '913362977923c76e5fd07c447f8381955656eb867910fd4a03d0f47e2d1fd9fb'
for name, expected in read(manifest)['members'].items():
    assert pin(D / name) == expected
report = read(D / 'REPORT.json')
assert report['entryCount'] == 42433 and report['contentModesPathsBlobsStagesAssumeValidIntentToAddEqual']
assert report['semanticFlagChangedEntries'] == report['rawChangedEntries'] == 1
assert report['changes'][0]['path'] == 'docs/qa/design-contrast.md'
assert report['changes'][0]['semanticChanges'] == {
    'extended': {'before': True, 'current': False}, 'skipWorktree': {'before': True, 'current': False},
    'flagsRaw': {'before': '401a', 'current': '001a'}, 'extendedFlagsRaw': {'before': '4000', 'current': '0000'}}
assert report['extensionsByteEqual'] and not report['unexplainedChangedOffsets']
original, current = pin(D / 'index.before.raw'), pin(D / 'index.current.raw')
assert original['sha256'] == '7398ff37f5c1e757d1ecdfea8e0a1db456d9f6bd5053f94887d1417c89fd7d7d'
assert current['sha256'] == '5097f228a1207a5db75ca1154c0f6d5afb37940772c57b00e54685ef984b2dbc'
assert pin(index) == current
env = {key: value for key, value in os.environ.items() if not key.upper().startswith('GIT_')}
env.update(GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')
git = ['C:/Program Files/Git/cmd/git.exe', '--no-optional-locks', '-C', str(W)]
stages = []
for frozen_index in (D / 'index.before.raw', D / 'index.current.raw'):
    stages.append(subprocess.check_output(git + ['ls-files', '--stage', '-z'], env=env | {'GIT_INDEX_FILE': str(frozen_index)}))
assert stages[0] == stages[1] and len(stages[0].split(b'\0')[:-1]) == 42433
assert not subprocess.check_output(git + ['diff', '--cached', '--name-only', '-z'], env=env)
contrast = W / 'docs/qa/design-contrast.md'
contrast_pin = pin(contrast)
assert contrast_pin == {'bytes': 94552, 'sha256': '3b62665a8d476887debf7809c3ab520318c2159799a1e5bf0d7eff66541902cb'}
blob = subprocess.check_output(git + ['rev-parse', 'HEAD:docs/qa/design-contrast.md'], env=env).decode().strip()
assert blob == '1957f5e21c6abad9f4a1f778ea3c62189ac675d3'
assert subprocess.check_output(git + ['cat-file', 'blob', blob], env=env) == contrast.read_bytes()
assert pin(index) == current
result = {'utc': datetime.now(timezone.utc).isoformat(), 'rootAcceptedIndexQualificationForChecksOnly': True,
          'controllerSnapshotIndex': original, 'currentIndex': current, 'independentManifest': pin(manifest),
          'independentReport': pin(D / 'REPORT.json'), 'allStageEntriesByteEqual': True,
          'stagedEntries': 42433, 'stagedEntriesSha256': sha256(stages[0]).hexdigest(),
          'stagedChanges': 0, 'soleFlagAndStatChange': report['changes'][0],
          'physicalContrastFile': contrast_pin, 'contrastHeadBlob': blob, 'readbackIndexUnchanged': True,
          'causeEstablished': False, 'sourceOrIndexWrites': False,
          'decision': 'Preserve both raw indices and the original closure; bind current index for subsequent checks with this explicit qualification.',
          'alternativesDeclined': ['Silently claiming byte-identical index preservation', 'Restoring the whole index despite equal staged contents', 'Treating the sparse metadata change as a product defect or user staged-content change']}
with (P / 'ROOT-INDEX-QUALIFICATION.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(result, stream, indent=2)
    stream.write('\n')
print(json.dumps({'qualification': pin(P / 'ROOT-INDEX-QUALIFICATION.json'), 'stageEntries': 42433,
                  'stagedChanges': 0, 'currentIndex': current, 'contrastVerified': True}))
