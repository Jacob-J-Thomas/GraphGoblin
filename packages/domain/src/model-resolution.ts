import type { Effort, HarnessDefaults, HarnessId, ModelCatalogEntry } from '@graphgoblin/contracts';

export interface HarnessModelResolutionInput {
  harness: HarnessId;
  model?: string;
  effort?: Effort;
  loopDefaults: HarnessDefaults;
  ownerDefaults: HarnessDefaults;
  processDefaults: HarnessDefaults;
  catalog: readonly ModelCatalogEntry[];
}
export type HarnessModelResolution =
  | { status: 'ready'; model: string; effort: Effort }
  | {
      status: 'invalid';
      code:
        | 'MODEL_UNRESOLVED'
        | 'EFFORT_UNRESOLVED'
        | 'MODEL_NOT_IN_CATALOG'
        | 'MODEL_HARNESS_MISMATCH'
        | 'EFFORT_UNSUPPORTED';
      path: 'model' | 'effort';
      message: string;
    }
  | { status: 'unavailable'; code: 'MODEL_DISABLED'; path: 'model'; message: string };

/** Resolve only the selected harness's defaults; catalog effort is guidance, never an implicit default. */
export function resolveHarnessModel(input: HarnessModelResolutionInput): HarnessModelResolution {
  const { harness, catalog } = input;
  const levels = [input.loopDefaults, input.ownerDefaults, input.processDefaults].map(
    (defaults) => defaults.byHarness[harness],
  );
  const model = input.model ?? levels.find((level) => level?.model !== undefined)?.model;
  const effort = input.effort ?? levels.find((level) => level?.effort !== undefined)?.effort;
  if (!model)
    return {
      status: 'invalid',
      code: 'MODEL_UNRESOLVED',
      path: 'model',
      message: 'No model is configured for the selected harness',
    };
  const entry = catalog.find((row) => row.harness === harness && row.model === model);
  if (!entry) {
    const mismatch = catalog.some((row) => row.model === model);
    return {
      status: 'invalid',
      code: mismatch ? 'MODEL_HARNESS_MISMATCH' : 'MODEL_NOT_IN_CATALOG',
      path: 'model',
      message: mismatch
        ? 'The selected model belongs to another harness'
        : 'The selected model is not in the catalog',
    };
  }
  if (!effort)
    return {
      status: 'invalid',
      code: 'EFFORT_UNRESOLVED',
      path: 'effort',
      message: 'No reasoning effort is configured for the selected harness',
    };
  if (!entry.efforts.includes(effort))
    return {
      status: 'invalid',
      code: 'EFFORT_UNSUPPORTED',
      path: 'effort',
      message: 'The selected reasoning effort is not supported by this model',
    };
  if (!entry.enabled)
    return {
      status: 'unavailable',
      code: 'MODEL_DISABLED',
      path: 'model',
      message: 'The selected model is disabled',
    };
  return { status: 'ready', model, effort };
}

export interface HarnessDefaultsIssue {
  level: 'loop' | 'owner' | 'process';
  harness: HarnessId;
  resolution: Extract<HarnessModelResolution, { status: 'invalid' }>;
}

/** Authored defaults are configuration, including values overridden by a higher layer. */
export function validateHarnessDefaults(
  input: Pick<
    HarnessModelResolutionInput,
    'loopDefaults' | 'ownerDefaults' | 'processDefaults' | 'catalog'
  >,
): HarnessDefaultsIssue[] {
  const levels = [
    ['loop', input.loopDefaults],
    ['owner', input.ownerDefaults],
    ['process', input.processDefaults],
  ] as const;
  const issues: HarnessDefaultsIssue[] = [];
  for (const [index, [level, defaults]] of levels.entries()) {
    for (const [harness, fields] of Object.entries(defaults.byHarness) as [
      HarnessId,
      { model?: string; effort?: Effort },
    ][]) {
      const lower = levels.slice(index).map(([, entry]) => entry.byHarness[harness]);
      const model = lower.find((entry) => entry?.model !== undefined)?.model;
      const entry = input.catalog.find((row) => row.harness === harness && row.model === model);
      let resolution: HarnessDefaultsIssue['resolution'] | undefined;
      if (fields.model !== undefined && !entry) {
        const mismatch = input.catalog.some((row) => row.model === fields.model);
        resolution = {
          status: 'invalid',
          code: mismatch ? 'MODEL_HARNESS_MISMATCH' : 'MODEL_NOT_IN_CATALOG',
          path: 'model',
          message: mismatch
            ? 'The default model belongs to another harness'
            : 'The default model is not in the catalog',
        };
      } else if (
        fields.effort !== undefined &&
        (!entry || !entry.efforts.includes(fields.effort))
      ) {
        resolution = {
          status: 'invalid',
          code: entry ? 'EFFORT_UNSUPPORTED' : 'MODEL_UNRESOLVED',
          path: entry ? 'effort' : 'model',
          message: entry
            ? 'The default reasoning effort is not supported by its model'
            : 'No model is configured for this reasoning effort default',
        };
      }
      if (resolution) issues.push({ level, harness, resolution });
    }
  }
  return issues;
}
