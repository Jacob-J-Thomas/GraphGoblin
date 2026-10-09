import type {
  HarnessPreflight,
  ModelCatalogEntry,
  TemplateCatalogEntry,
  TemplateDraftResponse,
  TemplateInstantiateResponse,
  TemplatePrerequisiteReport,
  ImplementationTemplateSettings,
  QaTemplateSettings,
  ReviewTemplateSettings,
  TemplateRepository,
  TemplateRoleSelection,
  TemplateSettings,
} from '@graphgoblin/contracts';
import {
  EffortSchema,
  HarnessIdSchema,
  ImplementationTemplateSettingsSchema,
  QaTemplateSettingsSchema,
  ReviewTemplateSettingsSchema,
  TemplateSettingsSchema,
} from '@graphgoblin/contracts';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Select,
  Textarea,
} from '../components/ui/index.js';
import { errorMessage } from '../lib/utils.js';

export type TemplateRolePreflight = HarnessPreflight & { harness: string };

export interface TemplateGalleryProps {
  templates: readonly TemplateCatalogEntry[];
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
  onCheckPrerequisites: (
    templateId: string,
    settings: TemplateSettings,
  ) => Promise<TemplatePrerequisiteReport>;
  onInstantiate: (
    templateId: string,
    settings: TemplateSettings,
  ) => Promise<TemplateInstantiateResponse>;
  onCreateDraft: (templateId: string) => Promise<TemplateDraftResponse>;
  onCreated: (parentLoopId: string) => void | Promise<void>;
  onCreateFailed?: () => void | Promise<void>;
}

function galleryRequirements(entry: TemplateCatalogEntry): TemplatePrerequisiteReport {
  return {
    ...entry.prerequisites,
    checks: entry.prerequisites.checks.map((check) => {
      if (check.id !== 'settings' || check.status === 'ok') return check;
      return entry.manifest.kind === 'starter'
        ? {
            ...check,
            message: 'Choose model defaults in Settings or edit the draft before running.',
            remediation: 'Set model defaults before running this draft.',
          }
        : {
            ...check,
            message: 'Repository settings are needed only for optional automation.',
            remediation: 'Use Configure automation to set the repository and roles.',
          };
    }),
  };
}

function statusTone(status: 'ok' | 'missing' | 'unavailable', optional = false) {
  if (status === 'ok') return 'good';
  if (status === 'missing' && optional) return 'warn';
  return status === 'missing' ? 'bad' : 'warn';
}

function RequirementReport({
  report,
  title,
  ariaLabel,
  note,
  context = 'setup',
  compact = false,
  headingLevel = 3,
}: {
  report: TemplatePrerequisiteReport;
  title: string;
  ariaLabel?: string;
  note?: string;
  context?: 'setup' | 'run' | 'automation';
  compact?: boolean;
  headingLevel?: 3 | 4;
}) {
  const ready = context === 'setup' ? report.canInstantiate : report.canRun;
  const checks = compact ? report.checks.filter((check) => check.status !== 'ok') : report.checks;
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  return (
    <section
      className={
        compact ? 'grid gap-3 md:row-span-2 md:grid md:grid-rows-subgrid md:gap-y-3' : 'grid gap-3'
      }
      aria-label={ariaLabel ?? title}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-sm font-semibold">{title}</Heading>
        {ready ? (
          <Badge tone="good">
            {context === 'setup'
              ? 'Ready to create draft'
              : context === 'run'
                ? 'Ready to run'
                : 'Ready to run automation'}
          </Badge>
        ) : (
          <Badge tone={context === 'automation' ? 'warn' : 'bad'}>
            {context === 'setup'
              ? 'Needs setup before creating'
              : context === 'run'
                ? 'Run setup needed'
                : 'Automation setup needed'}
          </Badge>
        )}
        {context === 'setup' && !report.canRun ? <Badge tone="warn">Runs not ready</Badge> : null}
      </div>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      {!compact && context === 'setup' && !report.canRun && report.canInstantiate ? (
        <Alert tone="warn" title="You can create this draft, but runs will stay blocked.">
          Every run remains blocked until the run-time requirements below are ready. Creating a
          draft does not enable those runs.
        </Alert>
      ) : null}
      {checks.length === 0 ? (
        <p className="text-sm text-muted">
          {compact
            ? 'All requirements met.'
            : 'No setup requirements are needed for this template.'}
        </p>
      ) : (
        <ul className="grid gap-2">
          {checks.map((check) => (
            <li
              key={check.id}
              data-prerequisite-id={check.id}
              className="rounded-md border border-default bg-surface-sunken p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{check.label}</span>
                <Badge tone={statusTone(check.status, context === 'automation')}>
                  {check.status}
                </Badge>
                <Badge tone="neutral">
                  {context === 'run'
                    ? 'Run requirement'
                    : context === 'automation'
                      ? 'Automation requirement'
                      : check.blocking === 'runtime'
                        ? 'Run-time requirement'
                        : 'Creation requirement'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{check.message}</p>
              {check.remediation ? (
                <p className="mt-1 text-sm text-default">Next step: {check.remediation}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function schemaProperty(
  schema: Record<string, unknown>,
  ...path: string[]
): Record<string, unknown> {
  let current: unknown = schema;
  for (const part of path) {
    const currentRecord = record(current);
    const properties = record(currentRecord?.['properties']);
    current = properties?.[part];
  }
  return record(current) ?? {};
}

function numberConstraint(schema: Record<string, unknown>, name: 'minimum' | 'maximum') {
  const value = schema[name];
  return typeof value === 'number' ? value : undefined;
}

function stringConstraint(schema: Record<string, unknown>, name: 'minLength' | 'maxLength') {
  const value = schema[name];
  return typeof value === 'number' ? value : undefined;
}

function defaultLabel(schema: Record<string, unknown>) {
  return typeof schema['title'] === 'string' ? schema['title'] : undefined;
}

function catalogModels(
  models: readonly ModelCatalogEntry[],
  preflight: readonly TemplateRolePreflight[],
  harness: string,
): ModelCatalogEntry[] {
  return models.filter((entry) => {
    if (entry.harness !== harness || !entry.enabled) return false;
    if (harness !== 'claude') return true;
    const ready = preflight.find((item) => item.harness === harness);
    return (
      ready?.ok === true &&
      ready.authenticated &&
      ready.models?.some(
        (capability) => capability.model === entry.model && capability.admission === 'supported',
      ) === true
    );
  });
}

function modelEfforts(
  model: ModelCatalogEntry | undefined,
  preflight: readonly TemplateRolePreflight[],
): readonly string[] {
  if (!model) return [];
  if (model.harness !== 'claude') return model.efforts;
  const capability = preflight
    .find((item) => item.harness === model.harness)
    ?.models?.find((item) => item.model === model.model && item.admission === 'supported');
  return capability ? model.efforts.filter((effort) => capability.efforts.includes(effort)) : [];
}

function settingsRoleAvailable(
  settings: TemplateSettings | null,
  models: readonly ModelCatalogEntry[],
  preflight: readonly TemplateRolePreflight[],
): boolean {
  const roles =
    settings?.kind === 'starter'
      ? [settings.roles.assistant]
      : settings?.kind === 'implementation'
        ? [settings.roles.implementer]
        : settings?.kind === 'review'
          ? [settings.roles.reviewer, settings.roles.fixer]
          : settings?.kind === 'qa'
            ? [settings.roles.qa, settings.roles.adversary]
            : [];
  return (
    roles.length > 0 &&
    roles.every((role) => {
      const readiness = preflight.find((item) => item.harness === role.harness);
      if (readiness?.ok !== true || !readiness.authenticated) return false;
      const selected = catalogModels(models, preflight, role.harness).find(
        (model) => model.model === role.model,
      );
      return selected !== undefined && modelEfforts(selected, preflight).includes(role.effort);
    })
  );
}

function schemaStringDefault(schema: Record<string, unknown>, fallback: string): string {
  return typeof schema['default'] === 'string' ? schema['default'] : fallback;
}

function schemaNumberDefault(schema: Record<string, unknown>, fallback: number): number {
  return typeof schema['default'] === 'number' ? schema['default'] : fallback;
}

function schemaBooleanDefault(schema: Record<string, unknown>, fallback: boolean): boolean {
  return typeof schema['default'] === 'boolean' ? schema['default'] : fallback;
}

function schemaStringArrayDefault(
  schema: Record<string, unknown>,
  fallback: readonly string[],
): string[] {
  const value = schema['default'];
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : [...fallback];
}

function templateRoleDefault(
  schema: Record<string, unknown>,
  models: readonly ModelCatalogEntry[],
  preflight: readonly TemplateRolePreflight[],
  roleKey: string,
  preferredModel?: string,
): TemplateRoleSelection {
  const codexModels = catalogModels(models, preflight, 'codex');
  const candidates = codexModels.flatMap((model) => {
    const efforts = modelEfforts(model, preflight);
    const effort = efforts.includes(model.defaultEffort) ? model.defaultEffort : efforts[0];
    const parsedEffort = EffortSchema.safeParse(effort);
    return parsedEffort.success ? [{ model, effort: parsedEffort.data }] : [];
  });
  const selected =
    candidates.find((candidate) => candidate.model.model === preferredModel) ?? candidates[0];
  const effortSchema = schemaProperty(schema, 'roles', roleKey, 'effort');
  const schemaEffort = Array.isArray(effortSchema['enum'])
    ? effortSchema['enum'].find((value): value is string => typeof value === 'string')
    : undefined;
  const fallbackEffort = EffortSchema.safeParse(schemaEffort);
  return {
    harness: 'codex',
    model: selected?.model.model ?? '',
    effort: selected?.effort ?? (fallbackEffort.success ? fallbackEffort.data : 'low'),
  };
}

function implementationSettingsDraft(
  entry: TemplateCatalogEntry,
  models: readonly ModelCatalogEntry[],
  preflight: readonly TemplateRolePreflight[],
): ImplementationTemplateSettings {
  const schema = entry.settingsSchema;
  const secretKey =
    entry.manifest.requiredSecrets[0]?.key ??
    entry.manifest.prerequisites.find((item) => item.kind === 'secret')?.secretKey ??
    '';
  return {
    kind: 'implementation',
    repository: { path: '', owner: '', name: '', baseBranch: '' },
    supportReadKey: secretKey,
    gate: {
      program: schemaStringDefault(schemaProperty(schema, 'gate', 'program'), 'pnpm'),
      args: schemaStringArrayDefault(schemaProperty(schema, 'gate', 'args'), ['check']),
      timeoutSeconds: schemaNumberDefault(schemaProperty(schema, 'gate', 'timeoutSeconds'), 600),
    },
    roles: { implementer: templateRoleDefault(schema, models, preflight, 'implementer') },
    labels: {
      trigger: schemaStringDefault(
        schemaProperty(schema, 'labels', 'trigger'),
        'ready-for-implementation',
      ),
      inProgress: schemaStringDefault(
        schemaProperty(schema, 'labels', 'inProgress'),
        'in-progress',
      ),
      prOpen: schemaStringDefault(schemaProperty(schema, 'labels', 'prOpen'), 'pr-open'),
      blocked: schemaStringDefault(schemaProperty(schema, 'labels', 'blocked'), 'blocked'),
    },
    limits: {
      maxTasks: schemaNumberDefault(schemaProperty(schema, 'limits', 'maxTasks'), 8),
      gateFixes: schemaNumberDefault(schemaProperty(schema, 'limits', 'gateFixes'), 2),
      maxIterations: schemaNumberDefault(schemaProperty(schema, 'limits', 'maxIterations'), 100),
    },
  };
}

function requiredChecksDefault(
  schema: Record<string, unknown>,
): ReviewTemplateSettings['requiredChecks'] {
  const configured = record(schemaProperty(schema, 'requiredChecks')['default']);
  const configuredNames = configured?.['names'];
  if (configured?.['source'] === 'explicit' && Array.isArray(configuredNames)) {
    const names = configuredNames.filter((name): name is string => typeof name === 'string');
    if (names.length === configuredNames.length) return { source: 'explicit', names };
  }
  return { source: 'protection' };
}

function reviewMergeMethodDefault(
  schema: Record<string, unknown>,
): ReviewTemplateSettings['mergeMethod'] {
  const value = schemaStringDefault(schemaProperty(schema, 'mergeMethod'), 'squash');
  return value === 'merge' || value === 'squash' || value === 'rebase' ? value : 'squash';
}

function reviewSettingsDraft(
  entry: TemplateCatalogEntry,
  models: readonly ModelCatalogEntry[],
  preflight: readonly TemplateRolePreflight[],
): ReviewTemplateSettings {
  const schema = entry.settingsSchema;
  const secretKey =
    entry.manifest.requiredSecrets[0]?.key ??
    entry.manifest.prerequisites.find((item) => item.kind === 'secret')?.secretKey ??
    '';
  const reviewer = templateRoleDefault(schema, models, preflight, 'reviewer');
  const nextCodexModel = catalogModels(models, preflight, 'codex').find(
    (model) => model.model !== reviewer.model,
  )?.model;
  return {
    kind: 'review',
    repository: { path: '', owner: '', name: '', baseBranch: '' },
    supportReadKey: secretKey,
    gate: {
      program: schemaStringDefault(schemaProperty(schema, 'gate', 'program'), 'pnpm'),
      args: schemaStringArrayDefault(schemaProperty(schema, 'gate', 'args'), ['check']),
      timeoutSeconds: schemaNumberDefault(schemaProperty(schema, 'gate', 'timeoutSeconds'), 600),
    },
    roles: {
      reviewer,
      fixer: templateRoleDefault(schema, models, preflight, 'fixer', nextCodexModel),
    },
    requireHumanBeforeMerge: schemaBooleanDefault(
      schemaProperty(schema, 'requireHumanBeforeMerge'),
      false,
    ),
    humanReviewLabels: schemaStringArrayDefault(schemaProperty(schema, 'humanReviewLabels'), []),
    needsHumanLabel: schemaStringDefault(schemaProperty(schema, 'needsHumanLabel'), 'needs-human'),
    trustedAuthors: schemaStringArrayDefault(schemaProperty(schema, 'trustedAuthors'), []),
    requiredChecks: requiredChecksDefault(schema),
    mergeMethod: reviewMergeMethodDefault(schema),
    limits: {
      automaticCycles: schemaNumberDefault(schemaProperty(schema, 'limits', 'automaticCycles'), 3),
      extraCycles: schemaNumberDefault(schemaProperty(schema, 'limits', 'extraCycles'), 3),
      reminders: schemaNumberDefault(schemaProperty(schema, 'limits', 'reminders'), 3),
      waitHours: schemaNumberDefault(schemaProperty(schema, 'limits', 'waitHours'), 24),
      ciWaitMinutes: schemaNumberDefault(schemaProperty(schema, 'limits', 'ciWaitMinutes'), 30),
    },
  };
}

function qaSettingsDraft(
  entry: TemplateCatalogEntry,
  models: readonly ModelCatalogEntry[],
  preflight: readonly TemplateRolePreflight[],
): QaTemplateSettings {
  const schema = entry.settingsSchema;
  const secretKey =
    entry.manifest.requiredSecrets[0]?.key ??
    entry.manifest.prerequisites.find((item) => item.kind === 'secret')?.secretKey ??
    '';
  const qa = templateRoleDefault(schema, models, preflight, 'qa');
  const distinctCodexModel = catalogModels(models, preflight, 'codex').find(
    (model) => model.model !== qa.model,
  )?.model;
  return {
    kind: 'qa',
    repository: { path: '', owner: '', name: '', baseBranch: '' },
    supportReadKey: secretKey,
    gate: {
      program: schemaStringDefault(schemaProperty(schema, 'gate', 'program'), 'pnpm'),
      args: schemaStringArrayDefault(schemaProperty(schema, 'gate', 'args'), ['check']),
      timeoutSeconds: schemaNumberDefault(schemaProperty(schema, 'gate', 'timeoutSeconds'), 600),
    },
    roles: {
      qa,
      adversary: templateRoleDefault(schema, models, preflight, 'adversary', distinctCodexModel),
    },
    depth:
      schemaStringDefault(schemaProperty(schema, 'depth'), 'standard') === 'full-regression'
        ? 'full-regression'
        : 'standard',
    ...(typeof schemaProperty(schema, 'fullRegressionLabel')['default'] === 'string'
      ? {
          fullRegressionLabel: schemaStringDefault(
            schemaProperty(schema, 'fullRegressionLabel'),
            '',
          ),
        }
      : {}),
    triggerLabel: schemaStringDefault(
      schemaProperty(schema, 'triggerLabel'),
      'ready-for-implementation',
    ),
    proofBranch: schemaStringDefault(schemaProperty(schema, 'proofBranch'), 'graphgoblin-proof'),
    limits: {
      unsoundReruns: schemaNumberDefault(schemaProperty(schema, 'limits', 'unsoundReruns'), 1),
      reworkRequests: schemaNumberDefault(schemaProperty(schema, 'limits', 'reworkRequests'), 2),
      reopenings: schemaNumberDefault(schemaProperty(schema, 'limits', 'reopenings'), 2),
      proofPushRetries: schemaNumberDefault(
        schemaProperty(schema, 'limits', 'proofPushRetries'),
        3,
      ),
    },
  };
}

function initialTemplateSettings(
  entry: TemplateCatalogEntry,
  models: readonly ModelCatalogEntry[],
  preflight: readonly TemplateRolePreflight[],
): TemplateSettings | null {
  if (entry.defaultSettings) return entry.defaultSettings;
  if (entry.manifest.kind === 'implementation') {
    return implementationSettingsDraft(entry, models, preflight);
  }
  if (entry.manifest.kind === 'review') {
    return reviewSettingsDraft(entry, models, preflight);
  }
  if (entry.manifest.kind === 'qa') {
    return qaSettingsDraft(entry, models, preflight);
  }
  return null;
}

function displayModel(entry: ModelCatalogEntry) {
  return entry.displayName === entry.model ? entry.model : `${entry.displayName} (${entry.model})`;
}

function TemplateRoleFields({
  settings,
  schema,
  models,
  preflight,
  roleKey,
  title,
  onChange,
}: {
  settings: TemplateRoleSelection;
  schema: Record<string, unknown>;
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
  roleKey: 'assistant' | 'implementer' | 'reviewer' | 'fixer' | 'qa' | 'adversary';
  title: string;
  onChange: (next: TemplateRoleSelection) => void;
}) {
  const id = useId();
  const availableHarnesses = [
    ...new Set(models.filter((model) => model.enabled).map((m) => m.harness)),
  ]
    .filter((harness) => harness === 'codex' || harness === 'claude')
    .filter(
      (harness) => harness !== 'claude' || catalogModels(models, preflight, harness).length > 0,
    );
  if (!availableHarnesses.includes(settings.harness)) availableHarnesses.unshift(settings.harness);
  const listedModels = catalogModels(models, preflight, settings.harness);
  const selectedModel = models.find(
    (model) => model.harness === settings.harness && model.model === settings.model,
  );
  const modelIsAvailable = listedModels.some((model) => model.model === settings.model);
  const effortOptions = modelEfforts(selectedModel, preflight);
  const effortIsAvailable = effortOptions.includes(settings.effort);
  const harnessSchema = schemaProperty(schema, 'roles', roleKey, 'harness');
  const modelSchema = schemaProperty(schema, 'roles', roleKey, 'model');
  const effortSchema = schemaProperty(schema, 'roles', roleKey, 'effort');
  const selectedPreflight = preflight.find((item) => item.harness === settings.harness);

  const update = (patch: Partial<TemplateRoleSelection>) => {
    if (patch.harness !== undefined) {
      const harness = HarnessIdSchema.safeParse(patch.harness);
      if (!harness.success) return;
      onChange({ ...settings, ...patch, harness: harness.data });
      return;
    }
    if (patch.effort !== undefined) {
      const effort = EffortSchema.safeParse(patch.effort);
      if (!effort.success) return;
      onChange({ ...settings, ...patch, effort: effort.data });
      return;
    }
    onChange({ ...settings, ...patch });
  };

  return (
    <fieldset className="grid gap-3 rounded-md border border-default p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <FieldGroup>
        <Label htmlFor={`${id}-harness`}>{defaultLabel(harnessSchema) ?? 'Harness'}</Label>
        <Select
          id={`${id}-harness`}
          value={settings.harness}
          onChange={(event) => {
            const next = HarnessIdSchema.safeParse(event.currentTarget.value);
            if (next.success) update({ harness: next.data });
          }}
        >
          {availableHarnesses.map((harness) => (
            <option key={harness} value={harness}>
              {harness === settings.harness &&
              !models.some((model) => model.harness === harness && model.enabled)
                ? `${harness} (unavailable)`
                : harness}
            </option>
          ))}
        </Select>
      </FieldGroup>
      <FieldGroup>
        <Label htmlFor={`${id}-model`}>{defaultLabel(modelSchema) ?? 'Model'}</Label>
        <Select
          id={`${id}-model`}
          value={settings.model}
          aria-invalid={modelIsAvailable ? undefined : true}
          aria-describedby={!modelIsAvailable ? `${id}-model-help` : undefined}
          onChange={(event) => update({ model: event.currentTarget.value })}
        >
          {!listedModels.some((model) => model.model === settings.model) ? (
            <option value={settings.model}>
              {settings.model || '(choose an enabled model)'} — unavailable
            </option>
          ) : null}
          {listedModels.map((model) => (
            <option key={`${model.harness}:${model.model}`} value={model.model}>
              {displayModel(model)}
            </option>
          ))}
        </Select>
        {!modelIsAvailable ? (
          <HelpText id={`${id}-model-help`} tone="bad">
            {settings.model
              ? 'This saved model is not currently available in the enabled catalog. Choose an enabled model or update the catalog in Settings.'
              : 'No current model is selected. Choose a listed model or enable a supported Codex model in Settings.'}
          </HelpText>
        ) : null}
        {selectedPreflight?.ok !== true || !selectedPreflight.authenticated ? (
          <HelpText tone="warn">
            This harness is not ready yet. Check its prerequisite and complete the suggested setup.
          </HelpText>
        ) : null}
      </FieldGroup>
      <FieldGroup>
        <Label htmlFor={`${id}-effort`}>{defaultLabel(effortSchema) ?? 'Effort'}</Label>
        <Select
          id={`${id}-effort`}
          value={settings.effort}
          aria-invalid={effortIsAvailable ? undefined : true}
          aria-describedby={!effortIsAvailable ? `${id}-effort-help` : undefined}
          onChange={(event) => {
            const next = EffortSchema.safeParse(event.currentTarget.value);
            if (next.success) update({ effort: next.data });
          }}
        >
          {!effortIsAvailable ? (
            <option value={settings.effort}>{settings.effort} — unavailable</option>
          ) : null}
          {effortOptions.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </Select>
        {!effortIsAvailable ? (
          <HelpText id={`${id}-effort-help`} tone="bad">
            This effort is not supported by the selected model. Choose a listed effort.
          </HelpText>
        ) : null}
      </FieldGroup>
    </fieldset>
  );
}

function StarterSettingsFields({
  entry,
  settings,
  models,
  preflight,
  onChange,
}: {
  entry: TemplateCatalogEntry;
  settings: Extract<TemplateSettings, { kind: 'starter' }>;
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
  onChange: (next: Extract<TemplateSettings, { kind: 'starter' }>) => void;
}) {
  const id = useId();
  const instructionSchema = schemaProperty(entry.settingsSchema, 'instruction');
  const iterationsSchema = schemaProperty(entry.settingsSchema, 'maxIterations');
  const instructionsMinimum = stringConstraint(instructionSchema, 'minLength');
  const instructionsMaximum = stringConstraint(instructionSchema, 'maxLength');
  const minimum = numberConstraint(iterationsSchema, 'minimum');
  const maximum = numberConstraint(iterationsSchema, 'maximum');
  const instructionError = settings.instruction.trim().length < (instructionsMinimum ?? 1);
  const iterationsError =
    !Number.isInteger(settings.maxIterations) ||
    (minimum !== undefined && settings.maxIterations < minimum) ||
    (maximum !== undefined && settings.maxIterations > maximum);
  const defaultInstruction = instructionSchema['default'];
  const updateAssistant = (assistant: TemplateRoleSelection) =>
    onChange({ ...settings, roles: { assistant } });

  return (
    <div className="grid gap-4">
      <FieldGroup>
        <Label htmlFor={`${id}-instruction`} required>
          {defaultLabel(instructionSchema) ?? 'Instruction'}
        </Label>
        <Textarea
          id={`${id}-instruction`}
          required
          value={settings.instruction}
          maxLength={instructionsMaximum}
          aria-invalid={instructionError || undefined}
          aria-describedby={`${id}-instruction-help`}
          onChange={(event) => onChange({ ...settings, instruction: event.currentTarget.value })}
        />
        <HelpText id={`${id}-instruction-help`}>
          {typeof instructionSchema['description'] === 'string'
            ? instructionSchema['description']
            : 'What the assistant should do when this loop runs.'}
          {typeof defaultInstruction === 'string' ? ` Default: ${defaultInstruction}` : ''}
        </HelpText>
        {instructionError ? (
          <HelpText tone="bad">
            Enter an instruction with at least {instructionsMinimum ?? 1} character.
          </HelpText>
        ) : null}
      </FieldGroup>
      <TemplateRoleFields
        settings={settings.roles.assistant}
        schema={entry.settingsSchema}
        models={models}
        preflight={preflight}
        roleKey="assistant"
        title="Assistant model"
        onChange={updateAssistant}
      />
      <FieldGroup>
        <Label htmlFor={`${id}-iterations`} required>
          {defaultLabel(iterationsSchema) ?? 'Maximum iterations'}
        </Label>
        <Input
          id={`${id}-iterations`}
          type="number"
          step={1}
          min={minimum}
          max={maximum}
          required
          value={Number.isFinite(settings.maxIterations) ? settings.maxIterations : ''}
          aria-invalid={iterationsError || undefined}
          aria-describedby={`${id}-iterations-help`}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            const value = raw === '' ? Number.NaN : Number(raw);
            onChange({ ...settings, maxIterations: value });
          }}
        />
        <HelpText id={`${id}-iterations-help`}>
          {typeof iterationsSchema['description'] === 'string'
            ? iterationsSchema['description']
            : `Choose a whole number${minimum !== undefined && maximum !== undefined ? ` from ${minimum} to ${maximum}` : ''}.`}
        </HelpText>
        {iterationsError ? (
          <HelpText tone="bad">Choose a whole number within the allowed range.</HelpText>
        ) : null}
      </FieldGroup>
    </div>
  );
}

function ImplementationSettingsFields({
  entry,
  settings,
  models,
  preflight,
  onChange,
}: {
  entry: TemplateCatalogEntry;
  settings: ImplementationTemplateSettings;
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
  onChange: (next: ImplementationTemplateSettings) => void;
}) {
  const id = useId();
  const parsed = ImplementationTemplateSettingsSchema.safeParse(settings);
  const issues = (path: string) => {
    if (parsed.success) return [];
    return parsed.error.issues
      .filter((issue) => {
        const issuePath = issue.path.map(String).join('.');
        return issuePath === path || issuePath.startsWith(`${path}.`);
      })
      .map((issue) => issue.message);
  };
  const describedBy = (helpId: string, path: string) =>
    issues(path).length > 0 ? `${helpId} ${helpId}-error` : helpId;
  const invalid = (path: string) => (issues(path).length > 0 ? true : undefined);
  const showIssues = (helpId: string, path: string) => {
    const messages = issues(path);
    return messages.length > 0 ? (
      <HelpText id={`${helpId}-error`} tone="bad">
        {messages.join(' ')}
      </HelpText>
    ) : null;
  };
  const updateRepository = <K extends keyof TemplateRepository>(
    key: K,
    value: TemplateRepository[K],
  ) => onChange({ ...settings, repository: { ...settings.repository, [key]: value } });
  const updateGate = <K extends keyof ImplementationTemplateSettings['gate']>(
    key: K,
    value: ImplementationTemplateSettings['gate'][K],
  ) => onChange({ ...settings, gate: { ...settings.gate, [key]: value } });
  const updateLabel = (key: keyof ImplementationTemplateSettings['labels'], value: string) =>
    onChange({ ...settings, labels: { ...settings.labels, [key]: value } });
  const updateLimit = (key: keyof ImplementationTemplateSettings['limits'], value: number) =>
    onChange({ ...settings, limits: { ...settings.limits, [key]: value } });
  const updateImplementer = (implementer: TemplateRoleSelection) =>
    onChange({ ...settings, roles: { implementer } });
  const secretKey =
    entry.manifest.requiredSecrets[0]?.key ??
    entry.manifest.prerequisites.find((item) => item.kind === 'secret')?.secretKey;
  const schema = entry.settingsSchema;
  const gateTimeoutSchema = schemaProperty(schema, 'gate', 'timeoutSeconds');
  const gateProgramSchema = schemaProperty(schema, 'gate', 'program');
  const gateArgsSchema = schemaProperty(schema, 'gate', 'args');
  const gateArgs = settings.gate.args.join('\n');
  const labelFields: {
    key: keyof ImplementationTemplateSettings['labels'];
    label: string;
  }[] = [
    { key: 'trigger', label: 'Trigger label' },
    { key: 'inProgress', label: 'In-progress label' },
    { key: 'prOpen', label: 'Pull request open label' },
    { key: 'blocked', label: 'Blocked label' },
  ];
  const limitFields: {
    key: keyof ImplementationTemplateSettings['limits'];
    label: string;
  }[] = [
    { key: 'maxTasks', label: 'Maximum tasks' },
    { key: 'gateFixes', label: 'Gate fixes' },
    { key: 'maxIterations', label: 'Maximum iterations' },
  ];

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Repository</legend>
        <p className="text-sm text-muted">
          Enter the existing checkout and repository identity this workflow may use. These values
          are checked again before a draft is created.
        </p>
        <FieldGroup>
          <Label htmlFor={`${id}-repository-path`} required>
            Checkout path
          </Label>
          <Input
            id={`${id}-repository-path`}
            required
            autoComplete="off"
            value={settings.repository.path}
            aria-invalid={invalid('repository.path')}
            aria-describedby={describedBy(`${id}-repository-path-help`, 'repository.path')}
            onChange={(event) => updateRepository('path', event.currentTarget.value)}
          />
          <HelpText id={`${id}-repository-path-help`}>
            Use an absolute local path without parent-directory segments.
          </HelpText>
          {showIssues(`${id}-repository-path-help`, 'repository.path')}
        </FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldGroup>
            <Label htmlFor={`${id}-repository-owner`} required>
              Repository owner
            </Label>
            <Input
              id={`${id}-repository-owner`}
              required
              autoComplete="off"
              value={settings.repository.owner}
              aria-invalid={invalid('repository.owner')}
              aria-describedby={describedBy(`${id}-repository-owner-help`, 'repository.owner')}
              onChange={(event) => updateRepository('owner', event.currentTarget.value)}
            />
            <HelpText id={`${id}-repository-owner-help`}>
              The GitHub account or organization.
            </HelpText>
            {showIssues(`${id}-repository-owner-help`, 'repository.owner')}
          </FieldGroup>
          <FieldGroup>
            <Label htmlFor={`${id}-repository-name`} required>
              Repository name
            </Label>
            <Input
              id={`${id}-repository-name`}
              required
              autoComplete="off"
              value={settings.repository.name}
              aria-invalid={invalid('repository.name')}
              aria-describedby={describedBy(`${id}-repository-name-help`, 'repository.name')}
              onChange={(event) => updateRepository('name', event.currentTarget.value)}
            />
            <HelpText id={`${id}-repository-name-help`}>The repository slug.</HelpText>
            {showIssues(`${id}-repository-name-help`, 'repository.name')}
          </FieldGroup>
        </div>
        <FieldGroup>
          <Label htmlFor={`${id}-base-branch`} required>
            Base branch
          </Label>
          <Input
            id={`${id}-base-branch`}
            required
            autoComplete="off"
            value={settings.repository.baseBranch}
            aria-invalid={invalid('repository.baseBranch')}
            aria-describedby={describedBy(`${id}-base-branch-help`, 'repository.baseBranch')}
            onChange={(event) => updateRepository('baseBranch', event.currentTarget.value)}
          />
          <HelpText id={`${id}-base-branch-help`}>
            The branch used as the work starting point.
          </HelpText>
          {showIssues(`${id}-base-branch-help`, 'repository.baseBranch')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-support-key`} required>
            Support credential key name
          </Label>
          <Input
            id={`${id}-support-key`}
            required
            autoComplete="off"
            readOnly={secretKey !== undefined}
            value={settings.supportReadKey}
            aria-invalid={invalid('supportReadKey')}
            aria-describedby={describedBy(`${id}-support-key-help`, 'supportReadKey')}
            onChange={(event) =>
              onChange({ ...settings, supportReadKey: event.currentTarget.value })
            }
          />
          <HelpText id={`${id}-support-key-help`}>
            Enter the configured key name only. Never paste a token or secret value here.
            {secretKey ? ` This template requires the key “${secretKey}”.` : ''}
          </HelpText>
          {showIssues(`${id}-support-key-help`, 'supportReadKey')}
        </FieldGroup>
      </fieldset>

      <TemplateRoleFields
        settings={settings.roles.implementer}
        schema={schema}
        models={models}
        preflight={preflight}
        roleKey="implementer"
        title="Implementer model"
        onChange={updateImplementer}
      />

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Check command</legend>
        <p className="text-sm text-muted">
          The program and arguments are passed as separate values. Shell syntax is not interpreted.
        </p>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-program`} required>
            Program
          </Label>
          <Input
            id={`${id}-gate-program`}
            required
            autoComplete="off"
            maxLength={stringConstraint(gateProgramSchema, 'maxLength')}
            value={settings.gate.program}
            aria-invalid={invalid('gate.program')}
            aria-describedby={describedBy(`${id}-gate-program-help`, 'gate.program')}
            onChange={(event) => updateGate('program', event.currentTarget.value)}
          />
          <HelpText id={`${id}-gate-program-help`}>
            Choose a native program available in the checkout.
          </HelpText>
          {showIssues(`${id}-gate-program-help`, 'gate.program')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-args`}>Arguments, one per line</Label>
          <Textarea
            id={`${id}-gate-args`}
            rows={4}
            value={gateArgs}
            aria-invalid={invalid('gate.args')}
            aria-describedby={describedBy(`${id}-gate-args-help`, 'gate.args')}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              updateGate('args', raw === '' ? [] : raw.split(/\r?\n/));
            }}
          />
          <HelpText id={`${id}-gate-args-help`}>
            Each line is one argument. Use at most{' '}
            {typeof gateArgsSchema['maxItems'] === 'number' ? gateArgsSchema['maxItems'] : 64}{' '}
            arguments; do not include shell operators.
          </HelpText>
          {showIssues(`${id}-gate-args-help`, 'gate.args')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-timeout`} required>
            Timeout in seconds
          </Label>
          <Input
            id={`${id}-gate-timeout`}
            type="number"
            step={1}
            min={numberConstraint(gateTimeoutSchema, 'minimum')}
            max={numberConstraint(gateTimeoutSchema, 'maximum')}
            required
            value={
              Number.isFinite(settings.gate.timeoutSeconds) ? settings.gate.timeoutSeconds : ''
            }
            aria-invalid={invalid('gate.timeoutSeconds')}
            aria-describedby={describedBy(`${id}-gate-timeout-help`, 'gate.timeoutSeconds')}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              updateGate('timeoutSeconds', raw === '' ? Number.NaN : Number(raw));
            }}
          />
          <HelpText id={`${id}-gate-timeout-help`}>
            Bounds: {numberConstraint(gateTimeoutSchema, 'minimum') ?? 1} to{' '}
            {numberConstraint(gateTimeoutSchema, 'maximum') ?? 86_400} seconds.
          </HelpText>
          {showIssues(`${id}-gate-timeout-help`, 'gate.timeoutSeconds')}
        </FieldGroup>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Repository labels</legend>
        <p className="text-sm text-muted">
          These labels are used to track implementation work. Choose values that match your
          repository workflow.
        </p>
        {labelFields.map(({ key, label }) => {
          const path = `labels.${key}`;
          const helpId = `${id}-label-${key}-help`;
          return (
            <FieldGroup key={key}>
              <Label htmlFor={`${id}-label-${key}`} required>
                {label}
              </Label>
              <Input
                id={`${id}-label-${key}`}
                required
                maxLength={stringConstraint(schemaProperty(schema, 'labels', key), 'maxLength')}
                value={settings.labels[key]}
                aria-invalid={invalid(path)}
                aria-describedby={describedBy(helpId, path)}
                onChange={(event) => updateLabel(key, event.currentTarget.value)}
              />
              <HelpText id={helpId}>A single label name.</HelpText>
              {showIssues(helpId, path)}
            </FieldGroup>
          );
        })}
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Work limits</legend>
        <p className="text-sm text-muted">Keep the amount of automated work within clear bounds.</p>
        {limitFields.map(({ key, label }) => {
          const path = `limits.${key}`;
          const fieldSchema = schemaProperty(schema, 'limits', key);
          const helpId = `${id}-limit-${key}-help`;
          return (
            <FieldGroup key={key}>
              <Label htmlFor={`${id}-limit-${key}`} required>
                {label}
              </Label>
              <Input
                id={`${id}-limit-${key}`}
                type="number"
                step={1}
                min={numberConstraint(fieldSchema, 'minimum')}
                max={numberConstraint(fieldSchema, 'maximum')}
                required
                value={Number.isFinite(settings.limits[key]) ? settings.limits[key] : ''}
                aria-invalid={invalid(path)}
                aria-describedby={describedBy(helpId, path)}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  updateLimit(key, raw === '' ? Number.NaN : Number(raw));
                }}
              />
              <HelpText id={helpId}>
                Whole number from {numberConstraint(fieldSchema, 'minimum') ?? 0} to{' '}
                {numberConstraint(fieldSchema, 'maximum') ?? 10_000}.
              </HelpText>
              {showIssues(helpId, path)}
            </FieldGroup>
          );
        })}
      </fieldset>
    </div>
  );
}

function ReviewSettingsFields({
  entry,
  settings,
  models,
  preflight,
  onChange,
}: {
  entry: TemplateCatalogEntry;
  settings: ReviewTemplateSettings;
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
  onChange: (next: ReviewTemplateSettings) => void;
}) {
  const id = useId();
  const parsed = ReviewTemplateSettingsSchema.safeParse(settings);
  const issues = (path: string) => {
    if (parsed.success) return [];
    return parsed.error.issues
      .filter((issue) => {
        const issuePath = issue.path.map(String).join('.');
        return issuePath === path || issuePath.startsWith(`${path}.`);
      })
      .map((issue) => issue.message);
  };
  const describedBy = (helpId: string, path: string) =>
    issues(path).length > 0 ? `${helpId} ${helpId}-error` : helpId;
  const invalid = (path: string) => (issues(path).length > 0 ? true : undefined);
  const showIssues = (helpId: string, path: string) => {
    const messages = issues(path);
    return messages.length > 0 ? (
      <HelpText id={`${helpId}-error`} tone="bad">
        {messages.join(' ')}
      </HelpText>
    ) : null;
  };
  const updateRepository = <K extends keyof TemplateRepository>(
    key: K,
    value: TemplateRepository[K],
  ) => onChange({ ...settings, repository: { ...settings.repository, [key]: value } });
  const updateGate = <K extends keyof ReviewTemplateSettings['gate']>(
    key: K,
    value: ReviewTemplateSettings['gate'][K],
  ) => onChange({ ...settings, gate: { ...settings.gate, [key]: value } });
  const updateLimits = <K extends keyof ReviewTemplateSettings['limits']>(
    key: K,
    value: ReviewTemplateSettings['limits'][K],
  ) => onChange({ ...settings, limits: { ...settings.limits, [key]: value } });
  const updateRole = (key: 'reviewer' | 'fixer', role: TemplateRoleSelection) =>
    onChange({ ...settings, roles: { ...settings.roles, [key]: role } });
  const secretKey =
    entry.manifest.requiredSecrets[0]?.key ??
    entry.manifest.prerequisites.find((item) => item.kind === 'secret')?.secretKey;
  const schema = entry.settingsSchema;
  const gateTimeoutSchema = schemaProperty(schema, 'gate', 'timeoutSeconds');
  const gateProgramSchema = schemaProperty(schema, 'gate', 'program');
  const gateArgsSchema = schemaProperty(schema, 'gate', 'args');
  const gateArgs = settings.gate.args.join('\n');
  const labels = [{ key: 'needsHumanLabel' as const, label: 'Needs-human label' }];
  const limitFields: { key: keyof ReviewTemplateSettings['limits']; label: string }[] = [
    { key: 'automaticCycles', label: 'Automatic review cycles' },
    { key: 'extraCycles', label: 'Additional human-requested cycles' },
    { key: 'reminders', label: 'Human reminders' },
    { key: 'waitHours', label: 'Hours before a reminder' },
    { key: 'ciWaitMinutes', label: 'Minutes to wait for checks' },
  ];

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Repository</legend>
        <p className="text-sm text-muted">
          Review only trusted pull requests from this configured repository and base branch. These
          values are checked again before a draft is created.
        </p>
        <FieldGroup>
          <Label htmlFor={`${id}-repository-path`} required>
            Checkout path
          </Label>
          <Input
            id={`${id}-repository-path`}
            required
            autoComplete="off"
            value={settings.repository.path}
            aria-invalid={invalid('repository.path')}
            aria-describedby={describedBy(`${id}-repository-path-help`, 'repository.path')}
            onChange={(event) => updateRepository('path', event.currentTarget.value)}
          />
          <HelpText id={`${id}-repository-path-help`}>
            Use the existing checkout that matches the repository's canonical origin.
          </HelpText>
          {showIssues(`${id}-repository-path-help`, 'repository.path')}
        </FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldGroup>
            <Label htmlFor={`${id}-repository-owner`} required>
              Repository owner
            </Label>
            <Input
              id={`${id}-repository-owner`}
              required
              autoComplete="off"
              value={settings.repository.owner}
              aria-invalid={invalid('repository.owner')}
              aria-describedby={describedBy(`${id}-repository-owner-help`, 'repository.owner')}
              onChange={(event) => updateRepository('owner', event.currentTarget.value)}
            />
            <HelpText id={`${id}-repository-owner-help`}>
              The GitHub account or organization.
            </HelpText>
            {showIssues(`${id}-repository-owner-help`, 'repository.owner')}
          </FieldGroup>
          <FieldGroup>
            <Label htmlFor={`${id}-repository-name`} required>
              Repository name
            </Label>
            <Input
              id={`${id}-repository-name`}
              required
              autoComplete="off"
              value={settings.repository.name}
              aria-invalid={invalid('repository.name')}
              aria-describedby={describedBy(`${id}-repository-name-help`, 'repository.name')}
              onChange={(event) => updateRepository('name', event.currentTarget.value)}
            />
            <HelpText id={`${id}-repository-name-help`}>The repository slug.</HelpText>
            {showIssues(`${id}-repository-name-help`, 'repository.name')}
          </FieldGroup>
        </div>
        <FieldGroup>
          <Label htmlFor={`${id}-base-branch`} required>
            Base branch
          </Label>
          <Input
            id={`${id}-base-branch`}
            required
            autoComplete="off"
            value={settings.repository.baseBranch}
            aria-invalid={invalid('repository.baseBranch')}
            aria-describedby={describedBy(`${id}-base-branch-help`, 'repository.baseBranch')}
            onChange={(event) => updateRepository('baseBranch', event.currentTarget.value)}
          />
          <HelpText id={`${id}-base-branch-help`}>
            Only pull requests targeting this branch are reviewed.
          </HelpText>
          {showIssues(`${id}-base-branch-help`, 'repository.baseBranch')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-support-key`} required>
            Support credential key name
          </Label>
          <Input
            id={`${id}-support-key`}
            required
            autoComplete="off"
            readOnly={secretKey !== undefined}
            value={settings.supportReadKey}
            aria-invalid={invalid('supportReadKey')}
            aria-describedby={describedBy(`${id}-support-key-help`, 'supportReadKey')}
            onChange={(event) =>
              onChange({ ...settings, supportReadKey: event.currentTarget.value })
            }
          />
          <HelpText id={`${id}-support-key-help`}>
            Enter the configured key name only. Never paste a token or secret value.
            {secretKey ? ` This template requires the key “${secretKey}”.` : ''}
          </HelpText>
          {showIssues(`${id}-support-key-help`, 'supportReadKey')}
        </FieldGroup>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Review and fixing roles</legend>
        <p className="text-sm text-muted">
          The reviewer is read-only. Fixing uses a separate fresh session; both roles are checked
          against the current model catalog and harness preflight.
        </p>
        <TemplateRoleFields
          settings={settings.roles.reviewer}
          schema={schema}
          models={models}
          preflight={preflight}
          roleKey="reviewer"
          title="Reviewer model"
          onChange={(role) => updateRole('reviewer', role)}
        />
        <TemplateRoleFields
          settings={settings.roles.fixer}
          schema={schema}
          models={models}
          preflight={preflight}
          roleKey="fixer"
          title="Fixer model"
          onChange={(role) => updateRole('fixer', role)}
        />
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Check command</legend>
        <p className="text-sm text-muted">
          The program and arguments are passed separately. Shell syntax is not interpreted.
        </p>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-program`} required>
            Program
          </Label>
          <Input
            id={`${id}-gate-program`}
            required
            autoComplete="off"
            maxLength={stringConstraint(gateProgramSchema, 'maxLength')}
            value={settings.gate.program}
            aria-invalid={invalid('gate.program')}
            aria-describedby={describedBy(`${id}-gate-program-help`, 'gate.program')}
            onChange={(event) => updateGate('program', event.currentTarget.value)}
          />
          <HelpText id={`${id}-gate-program-help`}>
            Choose a native program available in the checkout.
          </HelpText>
          {showIssues(`${id}-gate-program-help`, 'gate.program')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-args`}>Arguments, one per line</Label>
          <Textarea
            id={`${id}-gate-args`}
            rows={4}
            value={gateArgs}
            aria-invalid={invalid('gate.args')}
            aria-describedby={describedBy(`${id}-gate-args-help`, 'gate.args')}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              updateGate('args', raw === '' ? [] : raw.split(/\r?\n/));
            }}
          />
          <HelpText id={`${id}-gate-args-help`}>
            Each line is one argument. Use at most{' '}
            {typeof gateArgsSchema['maxItems'] === 'number' ? gateArgsSchema['maxItems'] : 64}{' '}
            arguments; do not include shell operators.
          </HelpText>
          {showIssues(`${id}-gate-args-help`, 'gate.args')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-timeout`} required>
            Timeout in seconds
          </Label>
          <Input
            id={`${id}-gate-timeout`}
            type="number"
            step={1}
            min={numberConstraint(gateTimeoutSchema, 'minimum')}
            max={numberConstraint(gateTimeoutSchema, 'maximum')}
            required
            value={
              Number.isFinite(settings.gate.timeoutSeconds) ? settings.gate.timeoutSeconds : ''
            }
            aria-invalid={invalid('gate.timeoutSeconds')}
            aria-describedby={describedBy(`${id}-gate-timeout-help`, 'gate.timeoutSeconds')}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              updateGate('timeoutSeconds', raw === '' ? Number.NaN : Number(raw));
            }}
          />
          <HelpText id={`${id}-gate-timeout-help`}>
            Bounds: {numberConstraint(gateTimeoutSchema, 'minimum') ?? 1} to{' '}
            {numberConstraint(gateTimeoutSchema, 'maximum') ?? 86_400} seconds.
          </HelpText>
          {showIssues(`${id}-gate-timeout-help`, 'gate.timeoutSeconds')}
        </FieldGroup>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Human review and merge</legend>
        <FieldGroup>
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-require-human`}
              type="checkbox"
              checked={settings.requireHumanBeforeMerge}
              aria-invalid={invalid('requireHumanBeforeMerge')}
              aria-describedby={describedBy(`${id}-require-human-help`, 'requireHumanBeforeMerge')}
              onChange={(event) =>
                onChange({ ...settings, requireHumanBeforeMerge: event.currentTarget.checked })
              }
            />
            <Label htmlFor={`${id}-require-human`}>Require a human choice before every merge</Label>
          </div>
          <HelpText id={`${id}-require-human-help`}>
            A human must answer the run's review wait. A reviewer verdict is not a GitHub approving
            review.
          </HelpText>
          {showIssues(`${id}-require-human-help`, 'requireHumanBeforeMerge')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-human-review-labels`}>Labels that require human review</Label>
          <Textarea
            id={`${id}-human-review-labels`}
            rows={3}
            value={settings.humanReviewLabels.join('\n')}
            aria-invalid={invalid('humanReviewLabels')}
            aria-describedby={describedBy(`${id}-human-review-labels-help`, 'humanReviewLabels')}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              onChange({ ...settings, humanReviewLabels: raw === '' ? [] : raw.split(/\r?\n/) });
            }}
          />
          <HelpText id={`${id}-human-review-labels-help`}>
            One issue label per line. A matching linked-issue label requires the human wait; if a PR
            has no linked issue, issue-label checks are skipped.
          </HelpText>
          {showIssues(`${id}-human-review-labels-help`, 'humanReviewLabels')}
        </FieldGroup>
        {labels.map(({ key, label }) => {
          const helpId = `${id}-${key}-help`;
          return (
            <FieldGroup key={key}>
              <Label htmlFor={`${id}-${key}`} required>
                {label}
              </Label>
              <Input
                id={`${id}-${key}`}
                required
                maxLength={stringConstraint(schemaProperty(schema, key), 'maxLength')}
                value={settings[key]}
                aria-invalid={invalid(key)}
                aria-describedby={describedBy(helpId, key)}
                onChange={(event) => onChange({ ...settings, [key]: event.currentTarget.value })}
              />
              <HelpText id={helpId}>
                Applied to a linked issue when the review times out or the person closes without
                merging. Standalone PR reviews have no issue to label.
              </HelpText>
              {showIssues(helpId, key)}
            </FieldGroup>
          );
        })}
        <FieldGroup>
          <Label htmlFor={`${id}-trusted-authors`}>Additional trusted authors</Label>
          <Textarea
            id={`${id}-trusted-authors`}
            rows={3}
            value={settings.trustedAuthors.join('\n')}
            aria-invalid={invalid('trustedAuthors')}
            aria-describedby={describedBy(`${id}-trusted-authors-help`, 'trustedAuthors')}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              onChange({ ...settings, trustedAuthors: raw === '' ? [] : raw.split(/\r?\n/) });
            }}
          />
          <HelpText id={`${id}-trusted-authors-help`}>
            One GitHub login per line. Leave empty to rely on the repository's authenticated write,
            maintain, or admin access check.
          </HelpText>
          {showIssues(`${id}-trusted-authors-help`, 'trustedAuthors')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-required-checks-source`}>Required checks</Label>
          <Select
            id={`${id}-required-checks-source`}
            value={settings.requiredChecks.source}
            aria-invalid={invalid('requiredChecks')}
            aria-describedby={describedBy(`${id}-required-checks-help`, 'requiredChecks')}
            onChange={(event) => {
              const source = event.currentTarget.value;
              if (source === 'protection') onChange({ ...settings, requiredChecks: { source } });
              else if (source === 'explicit') {
                const names =
                  settings.requiredChecks.source === 'explicit'
                    ? settings.requiredChecks.names
                    : [];
                onChange({ ...settings, requiredChecks: { source, names } });
              }
            }}
          >
            <option value="protection">Use repository protection rules</option>
            <option value="explicit">Use explicit check names</option>
          </Select>
          <HelpText id={`${id}-required-checks-help`}>
            Merge still uses ordinary GitHub protection. The review workflow cannot bypass
            repository rules.
          </HelpText>
          {settings.requiredChecks.source === 'explicit' ? (
            <>
              <Label htmlFor={`${id}-required-check-names`}>
                Required check names, one per line
              </Label>
              <Textarea
                id={`${id}-required-check-names`}
                rows={3}
                value={settings.requiredChecks.names.join('\n')}
                aria-invalid={invalid('requiredChecks.names')}
                aria-describedby={describedBy(
                  `${id}-required-check-names-help`,
                  'requiredChecks.names',
                )}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  onChange({
                    ...settings,
                    requiredChecks: {
                      source: 'explicit',
                      names: raw === '' ? [] : raw.split(/\r?\n/),
                    },
                  });
                }}
              />
              <HelpText id={`${id}-required-check-names-help`}>
                An empty list explicitly requires no named CI checks. Missing checks are never used
                to guess names.
              </HelpText>
              {showIssues(`${id}-required-check-names-help`, 'requiredChecks.names')}
            </>
          ) : null}
          {showIssues(`${id}-required-checks-help`, 'requiredChecks')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-merge-method`}>Merge method</Label>
          <Select
            id={`${id}-merge-method`}
            value={settings.mergeMethod}
            aria-invalid={invalid('mergeMethod')}
            aria-describedby={describedBy(`${id}-merge-method-help`, 'mergeMethod')}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'merge' || value === 'squash' || value === 'rebase')
                onChange({ ...settings, mergeMethod: value });
            }}
          >
            <option value="merge">Merge commit</option>
            <option value="squash">Squash merge</option>
            <option value="rebase">Rebase</option>
          </Select>
          <HelpText id={`${id}-merge-method-help`}>
            GitHub permissions, current head, required checks, and protection rules still control
            whether GitHub accepts a merge.
          </HelpText>
          {showIssues(`${id}-merge-method-help`, 'mergeMethod')}
        </FieldGroup>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Review limits</legend>
        <p className="text-sm text-muted">
          Automatic cycles, human-requested extra cycles, and reminders all have finite limits. A
          timeout never merges the pull request.
        </p>
        {limitFields.map(({ key, label }) => {
          const path = `limits.${key}`;
          const fieldSchema = schemaProperty(schema, 'limits', key);
          const helpId = `${id}-limit-${key}-help`;
          return (
            <FieldGroup key={key}>
              <Label htmlFor={`${id}-limit-${key}`} required>
                {label}
              </Label>
              <Input
                id={`${id}-limit-${key}`}
                type="number"
                step={1}
                min={numberConstraint(fieldSchema, 'minimum')}
                max={numberConstraint(fieldSchema, 'maximum')}
                required
                value={Number.isFinite(settings.limits[key]) ? settings.limits[key] : ''}
                aria-invalid={invalid(path)}
                aria-describedby={describedBy(helpId, path)}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  updateLimits(key, raw === '' ? Number.NaN : Number(raw));
                }}
              />
              <HelpText id={helpId}>
                Whole number from {numberConstraint(fieldSchema, 'minimum') ?? 0} to{' '}
                {numberConstraint(fieldSchema, 'maximum') ?? 10_000}.
              </HelpText>
              {showIssues(helpId, path)}
            </FieldGroup>
          );
        })}
      </fieldset>
    </div>
  );
}

function QaSettingsFields({
  entry,
  settings,
  models,
  preflight,
  onChange,
}: {
  entry: TemplateCatalogEntry;
  settings: QaTemplateSettings;
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
  onChange: (next: QaTemplateSettings) => void;
}) {
  const id = useId();
  const parsed = QaTemplateSettingsSchema.safeParse(settings);
  const issues = (path: string) => {
    if (parsed.success) return [];
    return parsed.error.issues
      .filter((issue) => {
        const issuePath = issue.path.map(String).join('.');
        return issuePath === path || issuePath.startsWith(`${path}.`);
      })
      .map((issue) => issue.message);
  };
  const describedBy = (helpId: string, path: string) =>
    issues(path).length > 0 ? `${helpId} ${helpId}-error` : helpId;
  const invalid = (path: string) => (issues(path).length > 0 ? true : undefined);
  const showIssues = (helpId: string, path: string) => {
    const messages = issues(path);
    return messages.length > 0 ? (
      <HelpText id={`${helpId}-error`} tone="bad">
        {messages.join(' ')}
      </HelpText>
    ) : null;
  };
  const updateRepository = <K extends keyof TemplateRepository>(
    key: K,
    value: TemplateRepository[K],
  ) => onChange({ ...settings, repository: { ...settings.repository, [key]: value } });
  const updateGate = <K extends keyof QaTemplateSettings['gate']>(
    key: K,
    value: QaTemplateSettings['gate'][K],
  ) => onChange({ ...settings, gate: { ...settings.gate, [key]: value } });
  const updateLimit = <K extends keyof QaTemplateSettings['limits']>(
    key: K,
    value: QaTemplateSettings['limits'][K],
  ) => onChange({ ...settings, limits: { ...settings.limits, [key]: value } });
  const updateRole = (key: 'qa' | 'adversary', role: TemplateRoleSelection) =>
    onChange({ ...settings, roles: { ...settings.roles, [key]: role } });
  const secretKey =
    entry.manifest.requiredSecrets[0]?.key ??
    entry.manifest.prerequisites.find((item) => item.kind === 'secret')?.secretKey;
  const schema = entry.settingsSchema;
  const gateProgramSchema = schemaProperty(schema, 'gate', 'program');
  const gateArgsSchema = schemaProperty(schema, 'gate', 'args');
  const gateTimeoutSchema = schemaProperty(schema, 'gate', 'timeoutSeconds');
  const gateArgs = settings.gate.args.join('\n');
  const limitFields: {
    key: keyof QaTemplateSettings['limits'];
    label: string;
    purpose: string;
  }[] = [
    {
      key: 'unsoundReruns',
      label: 'Unsound-evidence reruns',
      purpose: 'How many fresh QA attempts may follow evidence judged unsound.',
    },
    {
      key: 'reworkRequests',
      label: 'Rework requests',
      purpose: 'How many bounded requests to fix identified issues may be made.',
    },
    {
      key: 'reopenings',
      label: 'Issue reopenings',
      purpose: 'How many times the linked issue may be reopened for bounded rework.',
    },
    {
      key: 'proofPushRetries',
      label: 'Proof push retries',
      purpose: 'How many retries are allowed when saving the proof branch fails.',
    },
  ];

  return (
    <div className="grid gap-5">
      <Alert tone="warn" title="Enforced evidence-only isolation is unavailable">
        Publishing starts the poll and may select older eligible merged pull requests, one per poll;
        there is no initial cutoff. While isolation is unavailable, each selected pull request
        creates a failed attempt before checkout or a model turn, permanently consumes its merge and
        issue attempt, and may add one fixed explanation to the linked issue. Keep this template
        unpublished until enforced isolation is available. Every QA run remains blocked; no setting
        in this form can override that requirement.
      </Alert>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Repository</legend>
        <p className="text-sm text-muted">
          Enter the existing checkout and the exact repository and base branch for this QA recipe.
          The API checks the checkout and matching origin before creating a draft.
        </p>
        <FieldGroup>
          <Label htmlFor={`${id}-repository-path`} required>
            Checkout path
          </Label>
          <Input
            id={`${id}-repository-path`}
            required
            autoComplete="off"
            value={settings.repository.path}
            aria-invalid={invalid('repository.path')}
            aria-describedby={describedBy(`${id}-repository-path-help`, 'repository.path')}
            onChange={(event) => updateRepository('path', event.currentTarget.value)}
          />
          <HelpText id={`${id}-repository-path-help`}>
            Use an absolute local path without parent-directory segments.
          </HelpText>
          {showIssues(`${id}-repository-path-help`, 'repository.path')}
        </FieldGroup>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldGroup>
            <Label htmlFor={`${id}-repository-owner`} required>
              Repository owner
            </Label>
            <Input
              id={`${id}-repository-owner`}
              required
              autoComplete="off"
              value={settings.repository.owner}
              aria-invalid={invalid('repository.owner')}
              aria-describedby={describedBy(`${id}-repository-owner-help`, 'repository.owner')}
              onChange={(event) => updateRepository('owner', event.currentTarget.value)}
            />
            <HelpText id={`${id}-repository-owner-help`}>
              The GitHub account or organization.
            </HelpText>
            {showIssues(`${id}-repository-owner-help`, 'repository.owner')}
          </FieldGroup>
          <FieldGroup>
            <Label htmlFor={`${id}-repository-name`} required>
              Repository name
            </Label>
            <Input
              id={`${id}-repository-name`}
              required
              autoComplete="off"
              value={settings.repository.name}
              aria-invalid={invalid('repository.name')}
              aria-describedby={describedBy(`${id}-repository-name-help`, 'repository.name')}
              onChange={(event) => updateRepository('name', event.currentTarget.value)}
            />
            <HelpText id={`${id}-repository-name-help`}>The repository slug.</HelpText>
            {showIssues(`${id}-repository-name-help`, 'repository.name')}
          </FieldGroup>
        </div>
        <FieldGroup>
          <Label htmlFor={`${id}-base-branch`} required>
            Base branch
          </Label>
          <Input
            id={`${id}-base-branch`}
            required
            autoComplete="off"
            value={settings.repository.baseBranch}
            aria-invalid={invalid('repository.baseBranch')}
            aria-describedby={describedBy(`${id}-base-branch-help`, 'repository.baseBranch')}
            onChange={(event) => updateRepository('baseBranch', event.currentTarget.value)}
          />
          <HelpText id={`${id}-base-branch-help`}>
            The branch used as the work starting point.
          </HelpText>
          {showIssues(`${id}-base-branch-help`, 'repository.baseBranch')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-support-key`} required>
            Support credential key name
          </Label>
          <Input
            id={`${id}-support-key`}
            required
            autoComplete="off"
            readOnly={secretKey !== undefined}
            value={settings.supportReadKey}
            aria-invalid={invalid('supportReadKey')}
            aria-describedby={describedBy(`${id}-support-key-help`, 'supportReadKey')}
            onChange={(event) =>
              onChange({ ...settings, supportReadKey: event.currentTarget.value })
            }
          />
          <HelpText id={`${id}-support-key-help`}>
            Enter the configured key name only. Never paste a token or secret value here.
            {secretKey ? ` This template requires the key “${secretKey}”.` : ''}
          </HelpText>
          {showIssues(`${id}-support-key-help`, 'supportReadKey')}
        </FieldGroup>
      </fieldset>

      <TemplateRoleFields
        settings={settings.roles.qa}
        schema={schema}
        models={models}
        preflight={preflight}
        roleKey="qa"
        title="QA model"
        onChange={(role) => updateRole('qa', role)}
      />
      <TemplateRoleFields
        settings={settings.roles.adversary}
        schema={schema}
        models={models}
        preflight={preflight}
        roleKey="adversary"
        title="Evidence-only adversary model"
        onChange={(role) => updateRole('adversary', role)}
      />
      <p className="text-sm text-muted">
        When available, choose a different model or harness for the evidence-only adversary to
        reduce shared blind spots. This does not enable the unavailable isolation requirement.
      </p>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">QA depth</legend>
        <FieldGroup>
          <Label htmlFor={`${id}-depth`} required>
            Depth
          </Label>
          <Select
            id={`${id}-depth`}
            value={settings.depth}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'standard' || value === 'full-regression') {
                onChange({ ...settings, depth: value });
              }
            }}
          >
            <option value="standard">Standard</option>
            <option value="full-regression">Full regression</option>
          </Select>
          <HelpText id={`${id}-depth-help`}>
            This is the default depth. If the optional label below is present on the linked issue,
            that issue uses full-regression depth. Neither setting guarantees an accepted proof.
          </HelpText>
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-full-regression-label`}>Full-regression issue label</Label>
          <Input
            id={`${id}-full-regression-label`}
            autoComplete="off"
            value={settings.fullRegressionLabel ?? ''}
            aria-invalid={invalid('fullRegressionLabel')}
            aria-describedby={describedBy(
              `${id}-full-regression-label-help`,
              'fullRegressionLabel',
            )}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              if (raw === '') {
                const next = { ...settings };
                delete next.fullRegressionLabel;
                onChange(next);
              } else {
                onChange({ ...settings, fullRegressionLabel: raw });
              }
            }}
          />
          <HelpText id={`${id}-full-regression-label-help`}>
            Optional. When this label is present on the linked issue, use full-regression depth.
            Leave blank to rely on the Depth setting above.
          </HelpText>
          {showIssues(`${id}-full-regression-label-help`, 'fullRegressionLabel')}
        </FieldGroup>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Issue and proof branch</legend>
        <FieldGroup>
          <Label htmlFor={`${id}-trigger-label`} required>
            Implementation trigger label
          </Label>
          <Input
            id={`${id}-trigger-label`}
            required
            autoComplete="off"
            maxLength={stringConstraint(schemaProperty(schema, 'triggerLabel'), 'maxLength')}
            value={settings.triggerLabel}
            aria-invalid={invalid('triggerLabel')}
            aria-describedby={describedBy(`${id}-trigger-label-help`, 'triggerLabel')}
            onChange={(event) => onChange({ ...settings, triggerLabel: event.currentTarget.value })}
          />
          <HelpText id={`${id}-trigger-label-help`}>
            The existing label used to select implementation issues. It must match the repository's
            label exactly.
          </HelpText>
          {showIssues(`${id}-trigger-label-help`, 'triggerLabel')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-proof-branch`} required>
            Dedicated proof branch
          </Label>
          <Input
            id={`${id}-proof-branch`}
            required
            autoComplete="off"
            maxLength={stringConstraint(schemaProperty(schema, 'proofBranch'), 'maxLength')}
            value={settings.proofBranch}
            aria-invalid={invalid('proofBranch')}
            aria-describedby={describedBy(`${id}-proof-branch-help`, 'proofBranch')}
            onChange={(event) => onChange({ ...settings, proofBranch: event.currentTarget.value })}
          />
          <HelpText id={`${id}-proof-branch-help`}>
            Use a branch reserved for saved QA evidence.
          </HelpText>
          {showIssues(`${id}-proof-branch-help`, 'proofBranch')}
        </FieldGroup>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">QA command</legend>
        <p className="text-sm text-muted">
          The program and arguments are passed as separate literal values. Shell syntax is not
          interpreted.
        </p>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-program`} required>
            Program
          </Label>
          <Input
            id={`${id}-gate-program`}
            required
            autoComplete="off"
            maxLength={stringConstraint(gateProgramSchema, 'maxLength')}
            value={settings.gate.program}
            aria-invalid={invalid('gate.program')}
            aria-describedby={describedBy(`${id}-gate-program-help`, 'gate.program')}
            onChange={(event) => updateGate('program', event.currentTarget.value)}
          />
          <HelpText id={`${id}-gate-program-help`}>
            Choose a native program available in the checkout.
          </HelpText>
          {showIssues(`${id}-gate-program-help`, 'gate.program')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-args`}>Arguments, one per line</Label>
          <Textarea
            id={`${id}-gate-args`}
            rows={4}
            value={gateArgs}
            aria-invalid={invalid('gate.args')}
            aria-describedby={describedBy(`${id}-gate-args-help`, 'gate.args')}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              updateGate('args', raw === '' ? [] : raw.split(/\r?\n/));
            }}
          />
          <HelpText id={`${id}-gate-args-help`}>
            Each line is one argument. Use at most{' '}
            {typeof gateArgsSchema['maxItems'] === 'number' ? gateArgsSchema['maxItems'] : 64}{' '}
            arguments; do not include shell operators.
          </HelpText>
          {showIssues(`${id}-gate-args-help`, 'gate.args')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={`${id}-gate-timeout`} required>
            Timeout in seconds
          </Label>
          <Input
            id={`${id}-gate-timeout`}
            type="number"
            step={1}
            min={numberConstraint(gateTimeoutSchema, 'minimum')}
            max={numberConstraint(gateTimeoutSchema, 'maximum')}
            required
            value={
              Number.isFinite(settings.gate.timeoutSeconds) ? settings.gate.timeoutSeconds : ''
            }
            aria-invalid={invalid('gate.timeoutSeconds')}
            aria-describedby={describedBy(`${id}-gate-timeout-help`, 'gate.timeoutSeconds')}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              updateGate('timeoutSeconds', raw === '' ? Number.NaN : Number(raw));
            }}
          />
          <HelpText id={`${id}-gate-timeout-help`}>
            Bounds: {numberConstraint(gateTimeoutSchema, 'minimum') ?? 1} to{' '}
            {numberConstraint(gateTimeoutSchema, 'maximum') ?? 86_400} seconds.
          </HelpText>
          {showIssues(`${id}-gate-timeout-help`, 'gate.timeoutSeconds')}
        </FieldGroup>
      </fieldset>

      <fieldset className="grid gap-3 rounded-md border border-default p-4">
        <legend className="px-1 text-sm font-semibold">Attempt limits</legend>
        <p className="text-sm text-muted">
          Each count is finite. The workflow does not automatically replenish an exhausted per-issue
          attempt budget.
        </p>
        {limitFields.map(({ key, label, purpose }) => {
          const path = `limits.${key}`;
          const fieldSchema = schemaProperty(schema, 'limits', key);
          const helpId = `${id}-limit-${key}-help`;
          return (
            <FieldGroup key={key}>
              <Label htmlFor={`${id}-limit-${key}`} required>
                {label}
              </Label>
              <Input
                id={`${id}-limit-${key}`}
                type="number"
                step={1}
                min={numberConstraint(fieldSchema, 'minimum')}
                max={numberConstraint(fieldSchema, 'maximum')}
                required
                value={Number.isFinite(settings.limits[key]) ? settings.limits[key] : ''}
                aria-invalid={invalid(path)}
                aria-describedby={describedBy(helpId, path)}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  updateLimit(key, raw === '' ? Number.NaN : Number(raw));
                }}
              />
              <HelpText id={helpId}>
                {purpose} Allowed range: {numberConstraint(fieldSchema, 'minimum') ?? 0} to{' '}
                {numberConstraint(fieldSchema, 'maximum') ?? 10_000}.
              </HelpText>
              {showIssues(helpId, path)}
            </FieldGroup>
          );
        })}
      </fieldset>
    </div>
  );
}

function SettingsFields({
  entry,
  settings,
  models,
  preflight,
  onChange,
}: {
  entry: TemplateCatalogEntry;
  settings: TemplateSettings;
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
  onChange: (next: TemplateSettings) => void;
}) {
  if (entry.manifest.kind === 'starter' && settings.kind === 'starter') {
    return (
      <StarterSettingsFields
        entry={entry}
        settings={settings}
        models={models}
        preflight={preflight}
        onChange={onChange}
      />
    );
  }
  if (entry.manifest.kind === 'implementation' && settings.kind === 'implementation') {
    return (
      <ImplementationSettingsFields
        entry={entry}
        settings={settings}
        models={models}
        preflight={preflight}
        onChange={onChange}
      />
    );
  }
  if (entry.manifest.kind === 'review' && settings.kind === 'review') {
    return (
      <ReviewSettingsFields
        entry={entry}
        settings={settings}
        models={models}
        preflight={preflight}
        onChange={onChange}
      />
    );
  }
  if (entry.manifest.kind === 'qa' && settings.kind === 'qa') {
    return (
      <QaSettingsFields
        entry={entry}
        settings={settings}
        models={models}
        preflight={preflight}
        onChange={onChange}
      />
    );
  }
  return (
    <Alert title="These template settings are not available in this gallery yet.">
      No JSON editor is provided for unsupported settings. Choose another template or contact the
      GraphGoblin owner.
    </Alert>
  );
}

function TemplateSetup({
  entry,
  models,
  preflight,
  onCheckPrerequisites,
  onInstantiate,
  onCreated,
  onClose,
}: {
  entry: TemplateCatalogEntry;
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
  onCheckPrerequisites: TemplateGalleryProps['onCheckPrerequisites'];
  onInstantiate: TemplateGalleryProps['onInstantiate'];
  onCreated: TemplateGalleryProps['onCreated'];
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<TemplateSettings | null>(() =>
    initialTemplateSettings(entry, models, preflight),
  );
  const [checked, setChecked] = useState<
    { settingsKey: string; report: TemplatePrerequisiteReport } | undefined
  >();
  const [checking, setChecking] = useState(false);
  const checkInFlightRef = useRef(false);
  const [checkError, setCheckError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [handoffError, setHandoffError] = useState<string>();
  const [createdLoopId, setCreatedLoopId] = useState<string>();
  const [dialogEpoch, setDialogEpoch] = useState(0);
  const settingsKey = settings ? JSON.stringify(settings) : '';
  const defaultKey = entry.defaultSettings ? JSON.stringify(entry.defaultSettings) : '';
  const isDefault = settingsKey !== '' && settingsKey === defaultKey;
  const checkedReport = checked?.settingsKey === settingsKey ? checked.report : undefined;
  const report = checkedReport ?? (isDefault ? entry.prerequisites : undefined);
  const settingsValid = settings !== null && TemplateSettingsSchema.safeParse(settings).success;
  const roleAvailable = settingsRoleAvailable(settings, models, preflight);
  const supported =
    ((entry.manifest.kind === 'starter' && settings?.kind === 'starter') ||
      (entry.manifest.kind === 'implementation' && settings?.kind === 'implementation') ||
      (entry.manifest.kind === 'review' && settings?.kind === 'review') ||
      (entry.manifest.kind === 'qa' && settings?.kind === 'qa')) &&
    settingsValid;
  const readyToInstantiate = Boolean(
    !createdLoopId && settingsValid && roleAvailable && report?.canInstantiate && supported,
  );

  const updateSettings = (next: TemplateSettings) => {
    setSettings(next);
    setCheckError(undefined);
    setCreateError(undefined);
  };

  const check = async () => {
    if (!settings || !settingsValid || !supported || checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    setChecking(true);
    setCheckError(undefined);
    try {
      const result = await onCheckPrerequisites(entry.manifest.id, settings);
      setChecked({ settingsKey: JSON.stringify(settings), report: result });
    } catch (error) {
      setCheckError(errorMessage(error));
    } finally {
      checkInFlightRef.current = false;
      setChecking(false);
    }
  };

  const createDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || !readyToInstantiate || creating) return;
    setCreating(true);
    setCreateError(undefined);
    setHandoffError(undefined);
    let parentLoopId: string;
    try {
      const result = await onInstantiate(entry.manifest.id, settings);
      parentLoopId = result.instance.parentLoopId;
      setCreatedLoopId(parentLoopId);
    } catch (error) {
      setCreateError(errorMessage(error));
      setCreating(false);
      return;
    }
    try {
      await onCreated(parentLoopId);
    } catch (error) {
      setHandoffError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const requestClose = (reason: 'escape' | 'backdrop' | 'button' | 'dismissed') => {
    if (creating) {
      // The native dialog can dismiss on a non-cancelable repeated Escape. Remount it if that
      // happens so the in-flight request stays visible and cannot be started again.
      if (reason === 'dismissed') setDialogEpoch((value) => value + 1);
      return;
    }
    onClose();
  };

  return (
    <Dialog
      key={dialogEpoch}
      open
      title={`New from ${entry.manifest.title}`}
      description={entry.manifest.description}
      closeLabel="Close template setup"
      onClose={requestClose}
      closeOnBackdrop={!creating}
      className="max-w-3xl"
    >
      <form
        onSubmit={(event) => void createDraft(event)}
        className="grid gap-6"
        aria-busy={creating}
      >
        <div className="flex flex-wrap gap-2" aria-label="Template tags">
          {entry.manifest.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
        {entry.manifest.kind === 'starter' ? (
          <p className="text-sm text-muted">
            This starter does not need GitHub or a repository checkout. The parent opens as a draft;
            any supporting loops are published automatically so the parent can reference them.
          </p>
        ) : null}
        {entry.manifest.kind === 'implementation' ? (
          <p className="text-sm text-muted">
            Configure the repository workflow below. Helper loops are published first; the parent
            opens as a draft for you to review.
          </p>
        ) : null}
        {entry.manifest.kind === 'review' ? (
          <div className="grid gap-2 text-sm text-muted">
            <p>
              Publishing this parent activates its configured pull-request review. The reviewer is
              read-only and each fixing pass uses a separate fresh session. A standalone pull
              request without a linked issue can be reviewed; issue-only label actions are skipped.
            </p>
            <p>
              A structured reviewer approval is not a GitHub approving review. Merges use the
              selected ordinary merge method and remain subject to current GitHub permissions,
              required checks, and repository protection. This workflow cannot bypass them.
            </p>
          </div>
        ) : null}
        {entry.manifest.kind === 'qa' ? (
          <div className="grid gap-2 text-sm text-muted">
            <p>
              This recipe can be saved as a draft when its authoring requirements pass. Enforced
              evidence-only isolation is unavailable, so QA work remains blocked before checkout or
              any model turn.
            </p>
            <p>
              A saved proof is not available yet. No setting here can override the unavailable
              isolation requirement or make a run produce accepted QA evidence.
            </p>
          </div>
        ) : null}
        {settings ? (
          <fieldset disabled={creating} className="grid gap-6 border-0 p-0">
            <SettingsFields
              entry={entry}
              settings={settings}
              models={models}
              preflight={preflight}
              onChange={updateSettings}
            />
          </fieldset>
        ) : (
          <Alert title="This template has no default settings.">
            The owner must provide a valid settings configuration before this template can be used.
          </Alert>
        )}
        {report ? (
          <RequirementReport
            report={report}
            title="Requirements"
            note={
              checkedReport
                ? 'Checked for these settings.'
                : 'These checks use the template defaults.'
            }
          />
        ) : (
          <p className="text-sm text-muted">Check the current settings before creating a draft.</p>
        )}
        {checkError ? <Alert title="Could not check requirements">{checkError}</Alert> : null}
        {createError ? <Alert title="Could not create this draft">{createError}</Alert> : null}
        {handoffError && createdLoopId ? (
          <Alert title="Draft created, but the editor could not be opened">
            <p>{handoffError}</p>
            <Link
              className="mt-2 inline-block underline"
              to={`/loops/${encodeURIComponent(createdLoopId)}/edit`}
            >
              Open the created draft
            </Link>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => void check()}
            disabled={!settingsValid || !supported || creating}
            aria-disabled={checking || undefined}
            aria-busy={checking || undefined}
          >
            {checking ? 'Checking…' : 'Check requirements'}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" disabled={!readyToInstantiate || checking || creating}>
              {creating ? 'Creating draft…' : 'Create draft'}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

export function TemplateGallery({
  templates,
  models,
  preflight,
  onCheckPrerequisites,
  onInstantiate,
  onCreateDraft,
  onCreated,
  onCreateFailed,
}: TemplateGalleryProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TemplateCatalogEntry>();
  const [pendingTemplateId, setPendingTemplateId] = useState<string>();
  const actionInFlightRef = useRef(false);
  const [createdDrafts, setCreatedDrafts] = useState<Record<string, string>>({});
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [handoffErrors, setHandoffErrors] = useState<Record<string, string>>({});
  const openerId = useId();
  const openTemplate = (entry: TemplateCatalogEntry) => setSelected(entry);
  const closeTemplate = () => setSelected(undefined);

  const openCreatedDraft = async (templateId: string, loopId: string) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setPendingTemplateId(templateId);
    setHandoffErrors((current) => ({ ...current, [templateId]: '' }));
    try {
      await onCreated(loopId);
    } catch (error) {
      setHandoffErrors((current) => ({ ...current, [templateId]: errorMessage(error) }));
    } finally {
      actionInFlightRef.current = false;
      setPendingTemplateId(undefined);
    }
  };

  const createDraft = async (entry: TemplateCatalogEntry) => {
    const templateId = entry.manifest.id;
    if (actionInFlightRef.current || createdDrafts[templateId]) return;
    actionInFlightRef.current = true;
    setPendingTemplateId(templateId);
    setDraftErrors((current) => ({ ...current, [templateId]: '' }));
    setHandoffErrors((current) => ({ ...current, [templateId]: '' }));
    try {
      const result = await onCreateDraft(templateId);
      const loopId = result.loop.id;
      setCreatedDrafts((current) => ({ ...current, [templateId]: loopId }));
      try {
        await onCreated(loopId);
      } catch (error) {
        setHandoffErrors((current) => ({ ...current, [templateId]: errorMessage(error) }));
      }
    } catch (error) {
      setDraftErrors((current) => ({ ...current, [templateId]: errorMessage(error) }));
      try {
        // Reconcile the visible loop list after a failed or interrupted response. Never retry the
        // creation mutation automatically; a timed-out request may already have committed.
        await onCreateFailed?.();
      } catch {
        // Preserve the original creation error if the list refresh also fails.
      }
    } finally {
      actionInFlightRef.current = false;
      setPendingTemplateId(undefined);
    }
  };

  return (
    <div className="grid gap-4">
      <Button
        id={openerId}
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={`${openerId}-gallery`}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide templates' : 'New from template'}
      </Button>
      {open ? (
        <section
          id={`${openerId}-gallery`}
          aria-labelledby={`${openerId}-heading`}
          className="grid gap-3"
        >
          <div>
            <h2 id={`${openerId}-heading`} className="text-md font-semibold text-heading">
              Choose a template
            </h2>
            <p className="mt-1 text-sm text-muted">
              Drafts use their model defaults and the input or context you provide when running.
              Repository requirements below apply only to optional automation; use Configure
              automation for repository triggers and pull-request actions.
            </p>
          </div>
          {templates.length === 0 ? (
            <p className="text-sm text-muted">No templates are available right now.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {templates.map((entry) => (
                <Card
                  key={`${entry.manifest.id}:${entry.manifest.version}`}
                  title={entry.manifest.title}
                  titleLevel={3}
                  className="md:row-span-6 md:grid md:grid-rows-subgrid md:gap-y-3"
                  bodyClassName="grid gap-3 md:row-span-5 md:grid-rows-subgrid md:gap-y-3"
                >
                  <div className="text-sm text-muted">
                    <p>{entry.manifest.description}</p>
                  </div>
                  <div
                    className="flex flex-wrap content-start gap-2"
                    aria-label={`${entry.manifest.title} tags`}
                  >
                    {entry.manifest.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                  <RequirementReport
                    report={galleryRequirements(entry)}
                    title={
                      entry.manifest.kind === 'starter'
                        ? 'Run requirements'
                        : 'Optional automation requirements'
                    }
                    ariaLabel={`${entry.manifest.title} ${entry.manifest.kind === 'starter' ? 'run' : 'automation'} requirements`}
                    context={entry.manifest.kind === 'starter' ? 'run' : 'automation'}
                    compact
                    headingLevel={4}
                  />
                  <div className="grid content-start gap-2">
                    <div className="flex flex-col items-stretch gap-2">
                      {entry.manifest.draftFile ? (
                        <Button
                          type="button"
                          onClick={() => {
                            if (actionInFlightRef.current) return;
                            const createdLoopId = createdDrafts[entry.manifest.id];
                            if (createdLoopId) {
                              void openCreatedDraft(entry.manifest.id, createdLoopId);
                            } else {
                              void createDraft(entry);
                            }
                          }}
                          aria-disabled={pendingTemplateId !== undefined || undefined}
                          aria-busy={pendingTemplateId === entry.manifest.id || undefined}
                        >
                          {pendingTemplateId === entry.manifest.id
                            ? createdDrafts[entry.manifest.id]
                              ? 'Opening draft…'
                              : 'Creating draft…'
                            : createdDrafts[entry.manifest.id]
                              ? handoffErrors[entry.manifest.id]
                                ? 'Retry opening draft'
                                : 'Open draft'
                              : `Use ${entry.manifest.title}`}
                        </Button>
                      ) : (
                        <p className="text-sm text-muted">
                          An editable starting point is not available for this template.
                        </p>
                      )}
                      {entry.manifest.kind !== 'starter' ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="self-start"
                          aria-label={`Configure automation for ${entry.manifest.title}`}
                          onClick={() => {
                            if (!actionInFlightRef.current) openTemplate(entry);
                          }}
                          aria-disabled={pendingTemplateId !== undefined || undefined}
                        >
                          Configure automation
                        </Button>
                      ) : null}
                    </div>
                    {pendingTemplateId === entry.manifest.id ? (
                      <p role="status" aria-live="polite" className="text-sm text-muted">
                        {createdDrafts[entry.manifest.id] ? 'Opening draft…' : 'Creating draft…'}
                      </p>
                    ) : null}
                    {draftErrors[entry.manifest.id] ? (
                      <Alert title={`Could not create the ${entry.manifest.title} draft`}>
                        <p>{draftErrors[entry.manifest.id]}</p>
                        <p className="mt-2">
                          If the request timed out, check the loop list for a draft before trying
                          again.
                        </p>
                      </Alert>
                    ) : null}
                    {handoffErrors[entry.manifest.id] && createdDrafts[entry.manifest.id] ? (
                      <Alert
                        title={`${entry.manifest.title} draft created, but the editor could not be opened`}
                      >
                        <p>{handoffErrors[entry.manifest.id]}</p>
                        <Link
                          className="mt-2 inline-block underline"
                          to={`/loops/${encodeURIComponent(createdDrafts[entry.manifest.id]!)}/edit`}
                        >
                          Open the created draft
                        </Link>
                      </Alert>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}
      {selected ? (
        <TemplateSetup
          key={`${selected.manifest.id}:${selected.manifest.version}`}
          entry={selected}
          models={models}
          preflight={preflight}
          onCheckPrerequisites={onCheckPrerequisites}
          onInstantiate={onInstantiate}
          onCreated={onCreated}
          onClose={closeTemplate}
        />
      ) : null}
    </div>
  );
}
