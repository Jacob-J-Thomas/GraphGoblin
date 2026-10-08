import { describe, expect, it } from 'vitest';
import { CONTRACTS_SCHEMA_VERSION } from './index.js';

describe('contracts package', () => {
  it('exposes the schema version', () => {
    expect(CONTRACTS_SCHEMA_VERSION).toBe(3);
  });
});
