import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLicenseAllowed, evaluateLicenses, flattenPnpmLicenses } from './licenses.mjs';

const allowed = new Set(['MIT', 'Apache-2.0', 'ISC']);

test('plain licences', () => {
  assert.equal(isLicenseAllowed('MIT', allowed), true);
  assert.equal(isLicenseAllowed('GPL-3.0', allowed), false);
  assert.equal(isLicenseAllowed('', allowed), false);
  assert.equal(isLicenseAllowed('MIT*', allowed), false);
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

test('grouping cannot discard a required non-permissive licence', () => {
  assert.equal(isLicenseAllowed('GPL-3.0-only AND (MIT OR Apache-2.0)', allowed), false);
});

for (const expression of ['(MIT', 'MIT OR', 'AND MIT', '', 'MIT OR (ISC AND)']) {
  test(`malformed expression ${JSON.stringify(expression)} has a parse-error violation`, () => {
    const violations = evaluateLicenses({ allowed: [...allowed], exceptions: {} }, [
      { name: 'broken', versions: ['1.2.3'], license: expression },
    ]);
    assert.equal(violations.length, 1);
    assert.match(violations[0].reason, /parse error/i);
    assert.deepEqual(violations[0].versions, ['1.2.3']);
  });
}

test('guessed metadata has a distinct violation reason', () => {
  const [violation] = evaluateLicenses({ allowed: [...allowed], exceptions: {} }, [
    { name: 'guessed', license: 'MIT*' },
  ]);
  assert.match(violation?.reason ?? '', /guessed/i);
});

test('WITH requires explicit approval of the exact licence and exception pair', () => {
  const expression = 'Apache-2.0 WITH LLVM-exception';
  assert.equal(isLicenseAllowed(expression, allowed), false);
  assert.equal(isLicenseAllowed(expression, new Set([...allowed, expression])), true);
  const [violation] = evaluateLicenses({ allowed: [...allowed], exceptions: {} }, [
    { name: 'exception', license: expression },
  ]);
  assert.match(violation.reason, /WITH.*explicit/i);
});

test('nested grouping and SPDX precedence preserve all obligations', () => {
  for (const expression of [
    '((MIT OR GPL-3.0-only) AND (ISC OR GPL-3.0-only))',
    'GPL-3.0-only AND MIT OR ISC',
    'MIT OR ISC AND GPL-3.0-only',
    '(MIT)AND(ISC)',
    '  MIT\tAND\nISC  ',
  ])
    assert.equal(isLicenseAllowed(expression, allowed), true, expression);
  for (const expression of [
    '(MIT OR ISC) AND GPL-3.0-only',
    'GPL-3.0-only AND (MIT OR (Apache-2.0 AND ISC))',
    '(MIT OR GPL-3.0-only) AND (GPL-3.0-only OR AGPL-3.0-only)',
  ])
    assert.equal(isLicenseAllowed(expression, allowed), false, expression);
});

test('WITH binds to one licence and never drops its exception', () => {
  const pair = 'Apache-2.0 WITH LLVM-exception';
  const explicit = new Set([...allowed, pair]);
  assert.equal(isLicenseAllowed(`${pair} AND ISC`, explicit), true);
  assert.equal(isLicenseAllowed(`GPL-3.0-only AND (${pair} OR MIT)`, explicit), false);
  assert.equal(isLicenseAllowed(`${pair} OR MIT`, allowed), true);
  assert.equal(isLicenseAllowed(`MIT AND ${pair}`, allowed), false);
  assert.equal(isLicenseAllowed('Apache-2.0 WITH Other-exception', explicit), false);
  assert.equal(isLicenseAllowed(pair, new Set(['LLVM-exception', 'Apache-2.0'])), false);
});

for (const expression of [
  '()',
  'MIT)',
  'MIT ISC',
  'MIT OR (ISC',
  'MIT OR',
  'MIT WITH',
  'MIT WITH AND',
  'MIT WITH (LLVM-exception)',
  '(MIT OR ISC) WITH LLVM-exception',
  'MIT WITH LLVM-exception WITH Other',
  'MIT**',
  'MIT/ISC',
  'MIT WITH LLVM-exception*',
  'MIT or ISC',
]) {
  test(`rejects all of malformed expression ${JSON.stringify(expression)}`, () => {
    assert.equal(isLicenseAllowed(expression, new Set([...allowed, expression])), false);
    const [violation] = evaluateLicenses(
      { allowed: [...allowed], exceptions: { broken: 'reviewed metadata' } },
      [{ name: 'broken', license: expression }],
    );
    assert.match(violation.reason, /parse error/i);
  });
}

test('guessed markers require policy opt-in across every alternative; provenance is retained', () => {
  const pkg = { name: 'guessed', versions: ['1.0.0', '2.0.0'], license: 'MIT OR ISC*' };
  const policy = { allowed: [...allowed], exceptions: { guessed: 'metadata review' } };
  const [violation] = evaluateLicenses(policy, [pkg]);
  assert.deepEqual(
    { name: violation.name, versions: violation.versions, license: violation.license },
    pkg,
  );
  assert.match(violation.reason, /guessed.*ISC\*/);
  assert.deepEqual(evaluateLicenses({ ...policy, allowGuessed: true }, [pkg]), []);
  assert.equal(isLicenseAllowed('MIT*', allowed, { allowGuessed: true }), true);
  assert.equal(isLicenseAllowed('GPL-3.0-only*', allowed, { allowGuessed: true }), false);
  assert.equal(isLicenseAllowed('MIT**', allowed, { allowGuessed: true }), false);
  assert.equal(
    isLicenseAllowed(
      'Apache-2.0* WITH LLVM-exception',
      new Set(['Apache-2.0 WITH LLVM-exception']),
      { allowGuessed: true },
    ),
    true,
  );
});

test('package metadata overrides do not approve WITH pairs; inherited names are not exceptions', () => {
  const policy = { allowed: [...allowed], exceptions: { overridden: 'metadata reviewed' } };
  const violations = evaluateLicenses(policy, [
    { name: 'overridden', license: 'Apache-2.0 WITH LLVM-exception' },
    { name: 'toString', license: 'GPL-3.0-only' },
  ]);
  assert.deepEqual(
    violations.map((v) => v.name),
    ['overridden', 'toString'],
  );
  assert.match(violations[0].reason, /WITH.*explicit/);
});
