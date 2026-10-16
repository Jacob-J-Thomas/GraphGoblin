import { describe, expect, it } from 'vitest';
import {
  admissionContractCases,
  createFakeAdmissionFixture,
  runAdmissionContract,
} from './testing/index.js';

describe('fake admission contract', () => {
  it.each(admissionContractCases(createFakeAdmissionFixture))('$name', async (test) => {
    await test.run();
  });
  it('runs without a test-framework assertion dependency', async () => {
    const passed = await runAdmissionContract(createFakeAdmissionFixture);
    expect(passed).toHaveLength(admissionContractCases(createFakeAdmissionFixture).length);
  });
});
