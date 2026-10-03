import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLayers, findLayer, collectDependencies } from './layers.mjs';

const policy = {
  scope: '@graphgoblin/',
  ignore: ['@graphgoblin/tooling'],
  layers: [
    { name: 'contracts', match: '^@graphgoblin/contracts$', allow: [] },
    { name: 'domain', match: '^@graphgoblin/domain$', allow: ['@graphgoblin/contracts'] },
    { name: 'app', match: '^@graphgoblin/api$', allow: '*' },
  ],
};

test('findLayer matches by regex', () => {
  assert.equal(findLayer(policy, '@graphgoblin/domain')?.name, 'domain');
  assert.equal(findLayer(policy, '@graphgoblin/unknown'), undefined);
});

test('allowed dependencies pass', () => {
  const violations = evaluateLayers(policy, [
    {
      name: '@graphgoblin/domain',
      dependencies: { '@graphgoblin/contracts': 'workspace:*', zod: '^4' },
      location: 'packages/domain',
    },
    {
      name: '@graphgoblin/api',
      dependencies: { '@graphgoblin/domain': 'workspace:*' },
      location: 'apps/api',
    },
    { name: '@graphgoblin/tooling', dependencies: {}, location: 'tooling' },
  ]);
  assert.deepEqual(violations, []);
});

test('forbidden dependency is reported', () => {
  const violations = evaluateLayers(policy, [
    {
      name: '@graphgoblin/contracts',
      dependencies: { '@graphgoblin/domain': 'workspace:*' },
      location: 'packages/contracts',
    },
  ]);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /may not depend on @graphgoblin\/domain/);
});

test('tooling dependency is ignored', () => {
  const violations = evaluateLayers(policy, [
    {
      name: '@graphgoblin/contracts',
      dependencies: { '@graphgoblin/tooling': 'workspace:*' },
      location: 'packages/contracts',
    },
  ]);
  assert.deepEqual(violations, []);
});

test('unknown package and wrong scope are reported', () => {
  const violations = evaluateLayers(policy, [
    { name: '@graphgoblin/mystery', dependencies: {}, location: 'packages/mystery' },
    { name: 'rogue', dependencies: {}, location: 'packages/rogue' },
  ]);
  assert.equal(violations.length, 2);
  assert.match(violations[0].message, /does not match any layer/);
  assert.match(violations[1].message, /must start with/);
});

test('collectDependencies merges every dependency field', () => {
  assert.deepEqual(
    collectDependencies({
      dependencies: { a: '1' },
      devDependencies: { b: '2' },
      peerDependencies: { c: '3' },
      optionalDependencies: { d: '4' },
    }),
    { a: '1', b: '2', c: '3', d: '4' },
  );
  assert.deepEqual(collectDependencies({}), {});
});
