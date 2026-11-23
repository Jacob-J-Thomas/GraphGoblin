import difflib
import hashlib
import json
from pathlib import Path

out = Path(__file__).parent
first = out.parent / 'i5-d242-b2-native-qa-preparation-01'
audit = Path('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i5-564-final-astra-max-03/diagnostic/sent-action.cjs')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    with (out / name).open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


manifest = json.loads((first / 'MANIFEST.json').read_bytes())
assert sha((first / 'MANIFEST.json').read_bytes()) == '5a3cbeb29bf7f3a53962e64e0138024313ca8bec2f29e7b465077c0dae90e7c5'
for item in manifest['members']:
    raw = (first / item['path']).read_bytes()
    assert len(raw) == item['bytes'] and sha(raw) == item['sha256']
raw = (first / 'native.cjs').read_bytes()
assert sha(raw) == '189cd7ad9901c8d59434a878f2f572839c39347fecebd428ed0c2627e90f8b97'
old = """      const values = await page.getByRole('alert').allTextContents();
      for (let i = 0; i < values.length; i++) if (feedbackPattern.test(values[i]) && await page.getByRole('alert').nth(i).isVisible()) return values[i];
"""
new = """      const candidates = action === 'deletion' ? page.getByText(feedbackPattern) : page.getByRole('alert');
      const values = await candidates.allTextContents();
      for (let i = 0; i < values.length; i++) if (feedbackPattern.test(values[i]) && await candidates.nth(i).isVisible()) return values[i];
"""
text = raw.decode()
assert text.count(old) == 1
derived = text.replace(old, new, 1).encode()
assert derived.replace(new.encode(), old.encode(), 1) == raw
with (out / 'native.cjs').open('xb') as stream:
    stream.write(derived)
with (out / 'run-native.ps1').open('xb') as stream:
    stream.write((first / 'run-native.ps1').read_bytes())
for name in ['OLD-ROOT-BINDING.template.json', 'CORRECTED-ROOT-BINDING.template.json']:
    value = json.loads((first / name).read_bytes())
    assert value['executionAdmitted'] is False and value['preparationManifestSha256'] is None
    assert value['rootAdmission']['source'] is None
    # External fixture/build/equivalence references still point to exact immutable
    # preparation01 inputs. Root fills only this successor's admission/seal later.
    save(name, value)
with (out / 'locator.diff').open('x', encoding='utf-8', newline='\n') as stream:
    stream.writelines(difflib.unified_diff(text.splitlines(True), derived.decode().splitlines(True),
        fromfile='sealed-preparation01/native.cjs', tofile='preparation02/native.cjs'))
source = audit.read_text()
start = source.index('const errorPattern=')
end = source.index("result.runStillShown=", start)
excerpt = source[start:end]
assert "page.getByText(errorPattern).first().waitFor({state:'visible',timeout:2000})" in excerpt
assert "getByRole('alert')" not in excerpt
assert 'may or may not have been saved' in excerpt
save('AUDIT-LOCATOR-CHECK.json', {'source': str(audit), 'bytes': audit.stat().st_size, 'sha256': sha(audit.read_bytes()),
    'actualFeedbackLines': [138, 139, 140, 141, 142],
    'feedbackUsesVisibleTextLocator': True, 'deletionDoesNotRequireAlertRole': True,
    'originalPatternIncludesUncertainty': True, 'observationBudgetMs': 2000,
    'sourceExcerpt': excerpt, 'actualSourceOrBrowserExecuted': False})
save('DERIVATION.json', {'originalPreparationManifestSha256': sha((first / 'MANIFEST.json').read_bytes()),
    'originalMembersVerifiedUnchanged': len(manifest['members']), 'originalRunnerSha256': sha(raw),
    'newRunnerSha256': sha(derived), 'wrapperSha256': sha((out / 'run-native.ps1').read_bytes()),
    'onlyBehavioralDelta': 'Deletion feedback searches existing visible uncertainty text rather than requiring alert role. Script retains the role-alert predicate.',
    'allOtherNativeRunnerBytesReversibleExact': True, 'wrapperBytesUnchanged': True,
    'scriptRegexAndAlertRequirementUnchanged': True, 'deletionUncertaintyRegexUnchanged': True,
    'allSelectionsTimeoutsPreconditionsCountsAndPositiveControlsUnchanged': True,
    'oldRepro': 4, 'correctedAll': 10, 'actualBaselineOrFixtureRuntimeFailure': False,
    'rootRuntimeAdmission': False})
print(json.dumps({'nativeRunnerSha256': sha(derived), 'original01Unchanged': True, 'auditVisibleTextLocatorConfirmed': True,
                  'oldRepro': 4, 'correctedAll': 10, 'executionAdmitted': False}))
