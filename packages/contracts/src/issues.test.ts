import { describe, expect, it } from 'vitest';
import { LoopIssueSchema } from './index.js';

describe('loop validation issues', () => {
  it('preserves warning severity, node identity, and field path', () => {
    const warning = {
      code: 'MODEL_DISABLED',
      severity: 'warning',
      message: 'disabled',
      nodeId: 'infer',
      path: 'config.model',
    };
    expect(LoopIssueSchema.parse(warning)).toEqual(warning);
    expect(
      LoopIssueSchema.parse({
        code: 'MODEL_NOT_IN_CATALOG',
        severity: 'warning',
        message: 'missing',
        path: 'settings.defaults.model',
      }).nodeId,
    ).toBeUndefined();
  });
});
