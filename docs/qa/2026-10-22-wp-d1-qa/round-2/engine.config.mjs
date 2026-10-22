import base from '../../../../packages/engine/vitest.config.ts';
export default {
  ...base,
  test: { ...base.test, maxWorkers: 2, coverage: { ...base.test.coverage, reportOnFailure: true } },
};
