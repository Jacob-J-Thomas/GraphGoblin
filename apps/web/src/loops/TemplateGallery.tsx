import type {
  HarnessPreflight,
  ModelCatalogEntry,
  TemplateCatalogEntry,
  TemplateInstantiateResponse,
  TemplatePrerequisiteReport,
  TemplateRoleSelection,
  TemplateSettings,
} from '@graphgoblin/contracts';
import { EffortSchema, HarnessIdSchema, TemplateSettingsSchema } from '@graphgoblin/contracts';
import { useId, useState, type FormEvent } from 'react';
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
  onCreated: (parentLoopId: string) => void | Promise<void>;
}

function statusTone(status: 'ok' | 'missing' | 'unavailable') {
  return status === 'ok' ? 'good' : status === 'missing' ? 'bad' : 'warn';
}

function RequirementReport({
  report,
  title,
  note,
}: {
  report: TemplatePrerequisiteReport;
  title: string;
  note?: string;
}) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {report.canInstantiate ? (
          <Badge tone="good">Ready to create draft</Badge>
        ) : (
          <Badge tone="bad">Needs setup before creating</Badge>
        )}
        {!report.canRun ? <Badge tone="warn">Runs not ready</Badge> : null}
      </div>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      {!report.canRun && report.canInstantiate ? (
        <Alert tone="warn" title="You can create this draft, but runs will stay blocked.">
          Every run remains blocked until the run-time requirements below are ready. Creating a
          draft does not enable those runs.
        </Alert>
      ) : null}
      {report.checks.length === 0 ? (
        <p className="text-sm text-muted">No setup requirements are needed for this template.</p>
      ) : (
        <ul className="grid gap-2">
          {report.checks.map((check) => (
            <li
              key={check.id}
              data-prerequisite-id={check.id}
              className="rounded-md border border-default bg-surface-sunken p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{check.label}</span>
                <Badge tone={statusTone(check.status)}>{check.status}</Badge>
                <Badge tone="neutral">
                  {check.blocking === 'runtime' ? 'Run-time requirement' : 'Creation requirement'}
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
  if (!settings || settings.kind !== 'starter') return false;
  const role = settings.roles.assistant;
  const readiness = preflight.find((item) => item.harness === role.harness);
  if (readiness?.ok !== true || !readiness.authenticated) return false;
  const selected = catalogModels(models, preflight, role.harness).find(
    (model) => model.model === role.model,
  );
  return selected !== undefined && modelEfforts(selected, preflight).includes(role.effort);
}

function displayModel(entry: ModelCatalogEntry) {
  return entry.displayName === entry.model ? entry.model : `${entry.displayName} (${entry.model})`;
}

function AssistantRoleFields({
  settings,
  schema,
  models,
  preflight,
  onChange,
}: {
  settings: TemplateRoleSelection;
  schema: Record<string, unknown>;
  models: readonly ModelCatalogEntry[];
  preflight: readonly TemplateRolePreflight[];
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
  const harnessSchema = schemaProperty(schema, 'roles', 'assistant', 'harness');
  const modelSchema = schemaProperty(schema, 'roles', 'assistant', 'model');
  const effortSchema = schemaProperty(schema, 'roles', 'assistant', 'effort');
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
      <legend className="px-1 text-sm font-semibold">Assistant model</legend>
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
            This saved model is not currently available in the enabled catalog. Choose an enabled
            model or update the catalog in Settings.
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
      <AssistantRoleFields
        settings={settings.roles.assistant}
        schema={entry.settingsSchema}
        models={models}
        preflight={preflight}
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
  const [settings, setSettings] = useState<TemplateSettings | null>(entry.defaultSettings);
  const [checked, setChecked] = useState<
    { settingsKey: string; report: TemplatePrerequisiteReport } | undefined
  >();
  const [checking, setChecking] = useState(false);
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
    entry.manifest.kind === 'starter' && settings?.kind === 'starter' && settingsValid;
  const readyToInstantiate = Boolean(
    !createdLoopId && settingsValid && roleAvailable && report?.canInstantiate && supported,
  );

  const updateSettings = (next: TemplateSettings) => {
    setSettings(next);
    setCheckError(undefined);
    setCreateError(undefined);
  };

  const check = async () => {
    if (!settings || !settingsValid || !supported) return;
    setChecking(true);
    setCheckError(undefined);
    try {
      const result = await onCheckPrerequisites(entry.manifest.id, settings);
      setChecked({ settingsKey: JSON.stringify(settings), report: result });
    } catch (error) {
      setCheckError(errorMessage(error));
    } finally {
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
            disabled={!settingsValid || !supported || checking || creating}
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
  onCreated,
}: TemplateGalleryProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TemplateCatalogEntry>();
  const openerId = useId();
  const openTemplate = (entry: TemplateCatalogEntry) => setSelected(entry);
  const closeTemplate = () => setSelected(undefined);

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
              Start with a prepared loop, review its requirements, and open the parent as a draft.
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
                >
                  <p className="text-sm text-muted">{entry.manifest.description}</p>
                  <div
                    className="mt-3 flex flex-wrap gap-2"
                    aria-label={`${entry.manifest.title} tags`}
                  >
                    {entry.manifest.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-3">
                    <RequirementReport report={entry.prerequisites} title="Requirements" />
                    <Button type="button" onClick={() => openTemplate(entry)}>
                      Use {entry.manifest.title}
                    </Button>
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
