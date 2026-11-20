import { expect, it } from 'vitest';
import { StoreOwnershipRefusedError } from './data-dir-lock.js';
import { shellFailureOutput, startupFailureCause } from './serve.js';

it.each([
  {
    message: 'another GraphGoblin process holds /store/graphgoblin.lock',
    cause: 'store-held',
  },
  {
    message:
      'Store ownership could not be verified (malformed or incomplete owner record): /store/graphgoblin.lock',
    cause: 'store-ownership-unverified',
  },
])('renders typed $cause refusals while retaining the managed category', ({ message, cause }) => {
  const refusal = new StoreOwnershipRefusedError(message);
  expect(shellFailureOutput(refusal)).toBe(message);
  expect(startupFailureCause('store', refusal)).toBe(cause);

  // Matching text alone must not discard an unexpected error's diagnostic object.
  const unexpected = new Error(message);
  expect(shellFailureOutput(unexpected)).toBe(unexpected);
  expect(startupFailureCause('store', unexpected)).toBe(cause);
});

it('escapes ownership display controls while preserving the original error message', () => {
  const message =
    'Store ownership could not be verified (test): /store/a\nb\r\t\u001b\u007f\u0085\u2028\u2029/graphgoblin.lock';
  const refusal = new StoreOwnershipRefusedError(message);
  expect(shellFailureOutput(refusal)).toBe(
    'Store ownership could not be verified (test): /store/a\\u000ab\\u000d\\u0009\\u001b\\u007f\\u0085\\u2028\\u2029/graphgoblin.lock',
  );
  expect(refusal.message).toBe(message);
});

it('preserves process-identity diagnostics and their existing managed category', () => {
  const error = new Error('Cannot establish Windows process identity');
  expect(shellFailureOutput(error)).toBe(error);
  expect(startupFailureCause('store', error)).toBe('process-identity-unavailable');
});
