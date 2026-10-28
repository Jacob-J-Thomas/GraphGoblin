import type { HarnessDefaults } from '@graphgoblin/contracts';
import type { HarnessDefaultsIssue } from '@graphgoblin/domain';

/** One refused default, in the shape a run failure's `details` has for a defaults source. */
export interface DefaultsRefusalDetails {
  code: HarnessDefaultsIssue['resolution']['code'];
  path: HarnessDefaultsIssue['resolution']['path'];
  level: HarnessDefaultsIssue['level'];
  harness: HarnessDefaultsIssue['harness'];
}

/** An issue exists only for a harness entry that sets a model, an effort or both. */
function line(issue: HarnessDefaultsIssue, defaults: HarnessDefaults): string {
  const { model, effort } = { ...defaults.byHarness[issue.harness] };
  const chosen = Object.entries({ model, effort })
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => `${field} "${String(value)}"`)
    .join(', ');
  return `  ${issue.harness}: ${issue.resolution.code} at ${issue.resolution.path} (${chosen}): ${issue.resolution.message}.`;
}

/**
 * Startup refused `GG_DEFAULTS` before writing anything. Its message is the complete operator
 * explanation: every refused harness default with its code, the field, the configured model and
 * effort, and the way out. `details` is the first refusal, shaped like the `details` of a run that
 * fails on an inherited default (`code`, `path`, `level`, `harness`).
 */
export class ProcessDefaultsRefusedError extends Error {
  readonly code = 'EVALUATION_INVALID_CONFIGURATION';
  readonly details: DefaultsRefusalDetails;
  constructor(
    issues: readonly [HarnessDefaultsIssue, ...HarnessDefaultsIssue[]],
    defaults: HarnessDefaults,
  ) {
    super(
      [
        'GraphGoblin did not start: Invalid GG_DEFAULTS (EVALUATION_INVALID_CONFIGURATION).',
        ...issues.map((issue) => line(issue, defaults)),
        'No stored data was changed. Set GG_DEFAULTS to a model and effort the model catalog lists, or remove it, then start again.',
      ].join('\n'),
    );
    this.name = 'ProcessDefaultsRefusedError';
    const [first] = issues;
    this.details = {
      code: first.resolution.code,
      path: first.resolution.path,
      level: first.level,
      harness: first.harness,
    };
  }
}
