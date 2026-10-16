import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  LoopExportSchema,
  type LoopDefinition,
  type LoopExport,
} from '@graphgoblin/contracts';
import {
  upgradeLoopToV3 as upgradeLoopV3,
  validateUpgradeV3Resolutions as validateV2Resolutions,
  type ExitPredicateResolution,
} from './upgrade-v2-v3.js';
import {
  validateUpgradeResolutions,
  type UpgradeResolutions,
  type UpgradeIssue,
} from './upgrade.js';
import {
  convertDefinitionV3ToV4,
  definitionReviewHash,
  type DefinitionResolutions,
  type DefinitionReviewItem,
} from './convert-v3-v4/index.js';

/** Each frozen stage owns its keys; v3 keys and hashes belong to the E2 converter. */
export interface UpgradeCurrentResolutions {
  v1?: UpgradeResolutions;
  v2?: { predicates?: Record<string, ExitPredicateResolution> };
  v3?: DefinitionResolutions;
}
export interface CurrentUpgradeIssue extends UpgradeIssue {
  kind: 'pending' | 'invalid';
}
export type CurrentUpgradeResult<T> = {
  notices: UpgradeIssue[];
  reviewItems: DefinitionReviewItem[];
} & ({ ok: true; value: T } | { ok: false; issues: CurrentUpgradeIssue[] });

// The frozen stages retain their original result shapes. Classify their explicit review
// codes at the composition boundary rather than asking consumers to infer from spelling.
const pendingStageCodes = new Set([
  'UPGRADE_DECISION_CHOICE_REQUIRED',
  'UPGRADE_EXPRESSION_CHOICE_REQUIRED',
  'UPGRADE_OPAQUE_CONSUMER_REVIEW_REQUIRED',
  'UPGRADE_REFERENCE_CHOICE_REQUIRED',
  'UPGRADE_EXIT_BOOLEAN_REQUIRED',
  'UPGRADE_EXIT_CRITERIA_REQUIRED',
  'V4_EXIT_SCHEMA_POLICY_REQUIRED',
  'V4_TERMINAL_LIMIT_POLICY_REQUIRED',
]);
const classify = (entry: UpgradeIssue): CurrentUpgradeIssue => ({
  ...entry,
  kind: pendingStageCodes.has(entry.code) ? 'pending' : 'invalid',
});

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const issue = (code: string, path: string, message: string): CurrentUpgradeIssue => ({
  code,
  path,
  message,
  kind: 'invalid',
});
const invalid = () => [
  issue('UPGRADE_RESOLUTION_INVALID', '/', 'expected stage maps v1, v2 and v3'),
];

export function validateUpgradeCurrentResolutions(value: unknown): UpgradeIssue[] {
  if (!object(value) || Object.keys(value).some((key) => !['v1', 'v2', 'v3'].includes(key)))
    return invalid();
  if (value.v1 !== undefined) {
    const errors = validateUpgradeResolutions(value.v1);
    if (errors.length) return errors;
  }
  if (value.v2 !== undefined) {
    if (!object(value.v2) || Object.keys(value.v2).some((key) => key !== 'predicates'))
      return invalid();
    const errors = validateV2Resolutions(value.v2);
    if (errors.length) return errors;
  }
  if (value.v3 !== undefined && !object(value.v3)) return invalid();
  return [];
}

/** Explicit one-time conversion. No candidate definition escapes while review is pending. */
export async function upgradeLoopCurrent(
  input: unknown,
  resolutions: UpgradeCurrentResolutions = {},
): Promise<CurrentUpgradeResult<LoopDefinition>> {
  const errors = validateUpgradeCurrentResolutions(resolutions);
  if (errors.length)
    return { ok: false, issues: errors.map(classify), notices: [], reviewItems: [] };
  const version = object(input) ? input.schemaVersion : undefined;
  const unused = Object.entries(resolutions).some(
    ([stage, entries]) =>
      object(entries) &&
      Object.keys(entries).length > 0 &&
      (version === CURRENT_DEFINITION_FORMAT ||
        (stage === 'v1' && version !== 1) ||
        (stage === 'v2' && version === 3)),
  );
  if (unused)
    return {
      ok: false,
      issues: [issue('UPGRADE_RESOLUTION_INVALID', '/', 'unused stage resolutions')],
      notices: [],
      reviewItems: [],
    };
  if (version === CURRENT_DEFINITION_FORMAT) {
    const parsed = LoopDefinitionSchema.safeParse(input);
    return parsed.success
      ? { ok: true, value: parsed.data, notices: [], reviewItems: [] }
      : {
          ok: false,
          issues: [issue('UPGRADE_CURRENT_INVALID', '/', 'definition violates the current schema')],
          notices: [],
          reviewItems: [],
        };
  }
  const frozen = upgradeLoopV3(input, { ...resolutions.v1, ...resolutions.v2 });
  if (!frozen.ok)
    return { ...frozen, issues: frozen.issues.map(classify), notices: [], reviewItems: [] };
  // Portable inputs have no stored version ID. Bind reviews to their complete parsed content
  // in a separate namespace; never reuse approvals from a server version's manifest.
  const identity = 'portable:' + (await definitionReviewHash(frozen.value));
  const converted = await convertDefinitionV3ToV4(frozen.value, resolutions.v3, identity);
  const notices = [
    ...frozen.notices,
    ...converted.reviewItems
      .filter((item) => item.status === 'automatic')
      .map((item) => ({ code: item.kind, path: item.path, message: item.reason })),
  ];
  const pending = converted.reviewItems
    .filter((item) => item.status === 'pending')
    .map((item) => ({
      ...issue('UPGRADE_REVIEW_REQUIRED', item.path, item.reason),
      kind: 'pending' as const,
      id: item.id,
      hash: item.hash,
    }));
  if (!converted.ok || !converted.ready)
    return {
      ok: false,
      issues: [...(converted.ok ? [] : converted.issues.map(classify)), ...pending],
      notices,
      reviewItems: converted.reviewItems,
    };
  return { ok: true, value: converted.value, notices, reviewItems: converted.reviewItems };
}

export async function upgradeExportCurrent(
  input: unknown,
  resolutions: UpgradeCurrentResolutions = {},
): Promise<CurrentUpgradeResult<LoopExport>> {
  if (
    !object(input) ||
    Object.keys(input).some(
      (key) => !['format', 'formatVersion', 'exportedAt', 'loop'].includes(key),
    ) ||
    input.format !== 'graphgoblin-loop' ||
    ![1, 2, 3, CURRENT_DEFINITION_FORMAT].includes(Number(input.formatVersion)) ||
    !object(input.loop) ||
    input.loop.schemaVersion !== input.formatVersion ||
    !LoopExportSchema.shape.exportedAt.safeParse(input.exportedAt).success
  )
    return {
      ok: false,
      issues: [
        issue(
          'UPGRADE_EXPORT_INVALID',
          '/',
          'expected a matching exact loop export envelope and timestamp',
        ),
      ],
      notices: [],
      reviewItems: [],
    };
  const result = await upgradeLoopCurrent(input.loop, resolutions);
  if (!result.ok) return result;
  return {
    ...result,
    value: LoopExportSchema.parse({
      ...input,
      formatVersion: CURRENT_DEFINITION_FORMAT,
      loop: result.value,
    }),
  };
}
