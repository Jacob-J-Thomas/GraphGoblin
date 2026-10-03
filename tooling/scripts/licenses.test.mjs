import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLicenseAllowed, evaluateLicenses, flattenPnpmLicenses } from './licenses.mjs';

const allowed = new Set(['MIT', 'Apache-2.0', 'ISC']);

test('plain licences', () => {
  assert.equal(isLicenseAllowed('MIT', allowed), true);
  assert.equal(isLicenseAllowed('GPL-3.0', allowed), false);
  assert.equal(isLicenseAllowed('', allowed), false);
  assert.equal(isLicenseAllowed('MIT*', allowed), true);
});

test('OR expressions pass when any side is allowed', () => {
  assert.equal(isLicenseAllowed('(MIT OR GPL-3.0)', allowed), true);
  assert.equal(isLicenseAllowed('(GPL-3.0 OR AGPL-3.0)', allowed), false);
});

test('AND expressions require every side', () => {
  assert.equal(isLicenseAllowed('MIT AND ISC', allowed), true);
  assert.equal(isLicenseAllowed('MIT AND GPL-3.0', allowed), false);
});

test('evaluateLicenses reports violations and honours exceptions', () => {
  const policy = {
    allowed: [...allowed],
    exceptions: { 'weird-pkg': 'metadata missing, verified MIT upstream' },
  };
  const violations = evaluateLicenses(policy, [
    { name: 'ok-pkg', license: 'MIT' },
    { name: 'bad-pkg', license: 'SSPL-1.0' },
    { name: 'weird-pkg', license: 'UNKNOWN' },
  ]);
  assert.deepEqual(
    violations.map((v) => v.name),
    ['bad-pkg'],
  );
});

test('flattenPnpmLicenses flattens the pnpm shape', () => {
  const flat = flattenPnpmLicenses({
    MIT: [{ name: 'a', versions: ['1.0.0'] }, { name: 'b' }],
    'Apache-2.0': [{ name: 'c', license: 'Apache-2.0' }],
  });
  assert.deepEqual(flat, [
    { name: 'a', license: 'MIT', versions: ['1.0.0'] },
    { name: 'b', license: 'MIT' },
    { name: 'c', license: 'Apache-2.0' },
  ]);
});
