import { classifierModels, GraphGoblinApiError } from '@graphgoblin/api-client';
import type { ClassifierModelSummary } from '@graphgoblin/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useApi } from '../../api/context.js';
import { refreshClassifierState, useSecrets } from '../../api/queries.js';
import {
  Button,
  Checkbox,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Legend,
  RequiredMarker,
  RequiredNote,
  Select,
} from '../../components/ui/index.js';
import { errorMessage, problemIssues } from '../../lib/utils.js';
import {
  FORM_FIELDS,
  initialValues,
  PRIMITIVES,
  toPut,
  validateClassifier,
  type ClassifierFormErrors,
  type ClassifierFormField,
  type ClassifierFormValues,
} from '../classifier-form.js';
import { MutationError, SecretsLink, type MutationMessages } from '../shared.js';

/** Refusals of the classifier routes, as plain sentences (PUT, PATCH, and DELETE). */
export function classifierMessages(error: unknown): MutationMessages {
  const detail = error instanceof GraphGoblinApiError ? (error.detail ?? '') : '';
  const first = problemIssues(error)[0];
  return {
    CLASSIFIER_MODEL_NOT_FOUND: 'This classifier is no longer in the catalog.',
    CLASSIFIER_MANAGED_BY_SYSTEM: 'Built-in Jev can only be enabled or disabled.',
    CLASSIFIER_EXISTS:
      'A classifier with this id was added since the list loaded, so nothing was saved. Choose another id, or cancel and edit that classifier.',
    VALIDATION_FAILED: first
      ? `The API refused these settings: ${first}.`
      : 'The API refused these settings.',
    FORBIDDEN: detail.includes('secrets:write')
      ? 'Setting a bearer secret needs an API key with the secrets:write scope.'
      : 'Changing classifier models needs an API key with the settings:write scope.',
  };
}

/**
 * Add or edit a custom HTTP classifier. The id is fixed once created; a new entry starts disabled
 * and an edit keeps the entry's enabled state (PUT never sends it). The bearer secret is chosen
 * from the owner's secret names. Problems show beside their fields after the first Save, checked
 * against the contract; the first one takes focus.
 */
export function ClassifierModelForm({
  initial,
  existingIds,
  catalogReady,
  onDone,
}: {
  /** The entry being edited; absent when adding. */
  initial?: ClassifierModelSummary | undefined;
  existingIds: readonly string[];
  /**
   * Whether the classifier list has loaded, so `existingIds` is the catalog. A new entry is not
   * sent before then; the server's create-only precondition backs this up for stale lists.
   */
  catalogReady: boolean;
  /** Called after Cancel or a successful save, with the saved entry. */
  onDone: (saved?: ClassifierModelSummary) => void;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const secretsQuery = useSecrets();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const isNew = initial === undefined;
  const [values, setValues] = useState<ClassifierFormValues>(() => initialValues(initial));
  const [submitted, setSubmitted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const errors: ClassifierFormErrors = submitted
    ? validateClassifier(values, { existingIds, isNew })
    : {};
  const save = useMutation({
    // Adding never replaces: `create` sends If-None-Match: *, refused when the id exists. An edit
    // replaces the entry it was opened for, whatever the id field holds.
    mutationFn: () =>
      initial === undefined
        ? classifierModels.create(client, values.id, toPut(values))
        : classifierModels.upsert(client, initial.id, toPut(values)),
    onSuccess: () => refreshClassifierState(queryClient),
    onError: (failure) => {
      // Added elsewhere since this list loaded: refresh it, so the id check names the clash.
      if (failure instanceof GraphGoblinApiError && failure.code === 'CLASSIFIER_EXISTS')
        return refreshClassifierState(queryClient);
    },
  });
  const fieldId = (field: ClassifierFormField) => `${formId}-${field}`;

  // The first field takes focus when the form opens: the id when adding, else the display name.
  useEffect(() => {
    document.getElementById(`${formId}-${isNew ? 'id' : 'displayName'}`)?.focus();
  }, [formId, isNew]);

  const set = <K extends ClassifierFormField>(field: K, value: ClassifierFormValues[K]) => {
    // The id of an entry being edited is fixed (its input is read-only).
    if (field === 'id' && !isNew) return;
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    if (isNew && !catalogReady) {
      setWaiting(true);
      return;
    }
    setWaiting(false);
    setSubmitted(true);
    const found = validateClassifier(values, { existingIds, isNew });
    const first = FORM_FIELDS.find((field) => found[field] !== undefined);
    if (first) {
      const target =
        first === 'primitives'
          ? formRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')
          : document.getElementById(fieldId(first));
      target?.focus();
      return;
    }
    // Completion closes this form only while it is still open: a save that finishes after Cancel
    // (or after another form replaced this one) must not close whatever form is open by then.
    // TanStack Query drops these per-call callbacks once the form has unmounted.
    save.mutate(undefined, { onSuccess: (saved) => onDone(saved) });
  };

  /** Props linking a control to its help and error text. */
  const describe = (field: ClassifierFormField, help: boolean) => {
    const ids = [
      help ? `${fieldId(field)}-help` : '',
      errors[field] ? `${fieldId(field)}-error` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      ...(ids ? { 'aria-describedby': ids } : {}),
      ...(errors[field] ? { 'aria-invalid': true as const } : {}),
    };
  };
  const error = (field: ClassifierFormField) =>
    errors[field] ? (
      <HelpText id={`${fieldId(field)}-error`} tone="bad" role="alert">
        {errors[field]}
      </HelpText>
    ) : null;

  const secretNames = (secretsQuery.data ?? []).map((s) => s.name);
  // The current reference stays selected even when it is not set (yet) or the names did not load.
  const unlisted = values.secretRef !== '' && !secretNames.includes(values.secretRef);

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={submit}
      aria-label={isNew ? 'Add classifier' : `Edit classifier ${initial.id}`}
      className="grid gap-4 rounded-md border border-default bg-surface-sunken p-4"
    >
      <RequiredNote />
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldGroup>
          <Label htmlFor={fieldId('id')} required={isNew}>
            Id
          </Label>
          <Input
            id={fieldId('id')}
            className="font-mono text-sm"
            value={values.id}
            readOnly={!isNew}
            autoComplete="off"
            spellCheck={false}
            aria-required={isNew || undefined}
            {...describe('id', true)}
            onChange={(e) => set('id', e.target.value)}
          />
          <HelpText id={`${fieldId('id')}-help`}>
            {isNew
              ? 'Loops refer to the classifier by this id, so it cannot change later. A lowercase letter, then lowercase letters, digits, _ . or -.'
              : 'The id cannot change: loops refer to the classifier by it.'}
          </HelpText>
          {error('id')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={fieldId('displayName')} required>
            Display name
          </Label>
          <Input
            id={fieldId('displayName')}
            value={values.displayName}
            aria-required
            {...describe('displayName', false)}
            onChange={(e) => set('displayName', e.target.value)}
          />
          {error('displayName')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={fieldId('providerModel')} required>
            Provider model id
          </Label>
          <Input
            id={fieldId('providerModel')}
            className="font-mono text-sm"
            value={values.providerModel}
            autoComplete="off"
            spellCheck={false}
            aria-required
            {...describe('providerModel', true)}
            onChange={(e) => set('providerModel', e.target.value)}
          />
          <HelpText id={`${fieldId('providerModel')}-help`}>
            The model name sent to the endpoint, such as kev-latest.
          </HelpText>
          {error('providerModel')}
        </FieldGroup>
        <FieldGroup>
          <Label htmlFor={fieldId('endpoint')} required>
            Endpoint
          </Label>
          <Input
            id={fieldId('endpoint')}
            className="font-mono text-sm"
            type="url"
            inputMode="url"
            value={values.endpoint}
            placeholder="http://127.0.0.1:8008"
            autoComplete="off"
            spellCheck={false}
            aria-required
            {...describe('endpoint', true)}
            onChange={(e) => set('endpoint', e.target.value)}
          />
          <HelpText id={`${fieldId('endpoint')}-help`}>
            The API root. GraphGoblin sends POST &lt;endpoint&gt;/v1/systemone.
          </HelpText>
          {error('endpoint')}
        </FieldGroup>
      </div>
      <fieldset
        className="min-w-0"
        aria-describedby={[
          `${fieldId('primitives')}-help`,
          errors.primitives ? `${fieldId('primitives')}-error` : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Legend variant="label">
          Capabilities <RequiredMarker />
        </Legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {PRIMITIVES.map(({ value, label }) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 font-medium">
              <Checkbox
                checked={values.primitives.includes(value)}
                onChange={(e) =>
                  set(
                    'primitives',
                    e.target.checked
                      ? [...values.primitives, value]
                      : values.primitives.filter((p) => p !== value),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
        <HelpText id={`${fieldId('primitives')}-help`} className="mt-1.5">
          Choose at least 1. Decision nodes can select classifiers with Choice / classification.
        </HelpText>
        {error('primitives')}
      </fieldset>
      <FieldGroup className="max-w-md">
        <Label htmlFor={fieldId('secretRef')}>Bearer secret</Label>
        <Select
          id={fieldId('secretRef')}
          className="font-mono text-sm"
          value={values.secretRef}
          {...describe('secretRef', true)}
          onChange={(e) => set('secretRef', e.target.value)}
        >
          <option value="">(none)</option>
          {unlisted ? (
            <option value={values.secretRef}>
              {values.secretRef}
              {secretsQuery.isSuccess ? ' (not set)' : ''}
            </option>
          ) : null}
          {secretNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <div id={`${fieldId('secretRef')}-help`} className="grid gap-1">
          <HelpText>
            Optional. Its value is sent as Authorization: Bearer. Add or change secrets in{' '}
            <SecretsLink>Secrets</SecretsLink>.
          </HelpText>
          {values.secretRef ? (
            <HelpText>
              With a secret, the endpoint must use https:// unless its host is loopback (localhost,
              127.0.0.0/8, or [::1]). Saving it needs the secrets:write scope.
            </HelpText>
          ) : null}
          {secretsQuery.isError ? (
            <HelpText>
              Secret names could not be loaded: {errorMessage(secretsQuery.error)}
            </HelpText>
          ) : null}
        </div>
      </FieldGroup>
      {isNew ? (
        <HelpText>New classifiers start disabled; enable one in its row when it is ready.</HelpText>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {/* aria-disabled rather than disabled, so keyboard focus stays on Save while it saves. */}
        <Button type="submit" size="sm" aria-disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save classifier'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <MutationError error={save.error} messages={classifierMessages(save.error)} announce />
        {waiting ? (
          <HelpText tone="bad" role="alert">
            The classifier list has not loaded yet, so a new id cannot be checked. Save once it has
            loaded.
          </HelpText>
        ) : null}
      </div>
    </form>
  );
}
