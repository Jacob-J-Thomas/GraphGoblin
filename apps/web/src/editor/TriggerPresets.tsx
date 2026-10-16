import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, FieldGroup, HelpText, Input, Label, Select } from '../components/ui/index.js';
import { triggerFieldLabel } from './trigger-field-labels.js';
import {
  canApplyGitHubPreset,
  GITHUB_TRIGGER_PRESETS,
  makeGitHubTriggerPreset,
  unsupportedSigningScheme,
  type GitHubTriggerPreset,
  type GitHubTriggerSetup,
} from './trigger-presets.js';

const EMPTY_SETUP: GitHubTriggerSetup = {
  owner: '',
  repository: '',
  label: '',
  baseBranch: '',
  secretRef: '',
};

/** An accessible setup panel that applies an editable GitHub starter config in one editor step. */
export function TriggerPresets({
  config,
  heldInputs,
  historyEpoch,
  onApply,
}: {
  config: unknown;
  heldInputs?: Record<string, unknown> | undefined;
  historyEpoch?: number | undefined;
  onApply: (config: Record<string, unknown>) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const previewRegionRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{
    config: unknown;
    heldInputs: typeof heldInputs;
    historyEpoch: typeof historyEpoch;
    replacement: Record<string, unknown>;
  }>();
  const activePreview =
    preview?.config === config &&
    preview?.heldInputs === heldInputs &&
    preview?.historyEpoch === historyEpoch
      ? preview
      : undefined;
  useEffect(() => {
    if (preview) previewRegionRef.current?.focus();
  }, [preview]);
  const [preset, setPreset] = useState<GitHubTriggerPreset | ''>('');
  const [setup, setSetup] = useState(EMPTY_SETUP);
  const unsupported = unsupportedSigningScheme(config);
  const needsLabel = preset === 'issues-labeled' || preset === 'issues-poll';
  const needsBase = preset === 'pull-request-ready' || preset === 'pull-request-merged';
  const needsSecret = preset !== '' && preset !== 'issues-poll';
  const canApply = canApplyGitHubPreset(preset, setup);

  const update = (key: keyof GitHubTriggerSetup, value: string) =>
    setSetup((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preset && canApply)
      setPreview({
        config,
        heldInputs,
        historyEpoch,
        replacement: makeGitHubTriggerPreset(preset, setup),
      });
  };

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="grid gap-3 rounded-lg border border-default bg-surface-subtle p-3"
    >
      <div className="grid gap-1">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          Optional presets
        </h3>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={open}
          aria-controls={`${id}-setup`}
          onClick={() => {
            setOpen(!open);
            setPreview(undefined);
          }}
        >
          Start from a preset
        </Button>
      </div>

      {unsupported ? (
        <p
          role="alert"
          className="rounded-md border border-status-bad-border bg-status-bad-bg px-3 py-2 text-sm text-status-bad-fg"
        >
          Saved signing scheme <code>{unsupported}</code> is not supported. Its value is preserved;
          choose a supported trigger type or apply a preset to replace it deliberately.
        </p>
      ) : null}

      {open ? (
        <div id={`${id}-setup`} className="grid gap-3">
          <p className="text-xs text-muted">
            Choose an optional GitHub starting config, preview it, then edit its fields. Applying
            replaces the current trigger configuration in one undoable edit. GraphGoblin does not
            call GitHub from this editor.
          </p>
          <form aria-label="GitHub preset setup" onSubmit={submit} className="grid gap-3">
            <fieldset
              disabled={activePreview !== undefined}
              inert={activePreview !== undefined}
              className="grid gap-3 border-0 p-0 min-w-0"
            >
              <FieldGroup>
                <Label htmlFor={`${id}-preset`} required>
                  Preset
                </Label>
                <Select
                  id={`${id}-preset`}
                  required
                  value={preset}
                  onChange={(event) => setPreset(event.target.value as GitHubTriggerPreset | '')}
                >
                  <option value="">Choose a GitHub setup</option>
                  {GITHUB_TRIGGER_PRESETS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FieldGroup>

              {preset ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldGroup>
                    <Label htmlFor={`${id}-owner`} required>
                      Repository owner
                    </Label>
                    <Input
                      id={`${id}-owner`}
                      required
                      maxLength={39}
                      pattern={'[A-Za-z0-9](?:[A-Za-z0-9\\-]{0,37}[A-Za-z0-9])?'}
                      value={setup.owner}
                      onChange={(event) => update('owner', event.target.value)}
                      placeholder="octo-team"
                    />
                    <HelpText>Enter the owner name only.</HelpText>
                  </FieldGroup>
                  <FieldGroup>
                    <Label htmlFor={`${id}-repository`} required>
                      Repository
                    </Label>
                    <Input
                      id={`${id}-repository`}
                      required
                      maxLength={100}
                      pattern={'[A-Za-z0-9_.\\-]{1,100}'}
                      value={setup.repository}
                      onChange={(event) => update('repository', event.target.value)}
                      placeholder="service-repo"
                    />
                    <HelpText>
                      Enter one repository name; the preset builds the repository check.
                    </HelpText>
                  </FieldGroup>

                  {needsLabel ? (
                    <FieldGroup>
                      <Label htmlFor={`${id}-label`} required>
                        Issue label
                      </Label>
                      <Input
                        id={`${id}-label`}
                        required
                        maxLength={255}
                        value={setup.label}
                        onChange={(event) => update('label', event.target.value)}
                        placeholder="ready"
                      />
                      <HelpText>
                        {preset === 'issues-poll'
                          ? 'The label name is encoded safely in the gh query.'
                          : 'The label name is encoded safely in the webhook filter.'}
                      </HelpText>
                    </FieldGroup>
                  ) : null}

                  {needsBase ? (
                    <FieldGroup>
                      <Label htmlFor={`${id}-base`} required>
                        Pull request base branch
                      </Label>
                      <Input
                        id={`${id}-base`}
                        required
                        maxLength={255}
                        value={setup.baseBranch}
                        onChange={(event) => update('baseBranch', event.target.value)}
                        placeholder="main"
                      />
                      <HelpText>The filter checks the signed pull request body.</HelpText>
                    </FieldGroup>
                  ) : null}

                  {needsSecret ? (
                    <FieldGroup>
                      <Label htmlFor={`${id}-secret`} required>
                        Signing secret name
                      </Label>
                      <Input
                        id={`${id}-secret`}
                        required
                        maxLength={128}
                        value={setup.secretRef}
                        onChange={(event) => update('secretRef', event.target.value)}
                        placeholder="github-repo-hook"
                      />
                      <HelpText>Use a secret already stored in GraphGoblin Settings.</HelpText>
                    </FieldGroup>
                  ) : null}
                </div>
              ) : null}

              {preset && preset !== 'issues-poll' ? (
                <p className="rounded-md border border-default bg-surface px-3 py-2 text-xs text-muted">
                  The signature authenticates the exact request body. GitHub event and delivery
                  headers are unsigned hints; the delivery ID is only a business dedupe key. Exact
                  replay suppression uses the raw body independently of that ID.
                </p>
              ) : null}
              {preset === 'issues-poll' ? (
                <p className="rounded-md border border-default bg-surface px-3 py-2 text-xs text-muted">
                  This read-only poll uses an already-installed, authenticated local <code>gh</code>{' '}
                  command. It rejects output over 200 issues or 64 KiB, then admits up to 5 unseen
                  items per poll by default; all bounds and expressions remain editable in the
                  trigger fields.
                </p>
              ) : null}

              {preset ? (
                <div>
                  <Button ref={previewButtonRef} type="submit" size="sm" disabled={!canApply}>
                    Preview GitHub preset
                  </Button>
                </div>
              ) : null}
            </fieldset>
          </form>
          <p role="status" className={preview && !activePreview ? 'text-sm text-muted' : 'sr-only'}>
            {preview && !activePreview
              ? 'Preset preview is out of date. Preview the preset again before applying.'
              : ''}
          </p>
          {activePreview ? (
            <div
              ref={previewRegionRef}
              role="region"
              aria-label="Preset preview"
              tabIndex={-1}
              className="grid min-w-0 gap-3 rounded-md border border-default bg-surface p-3"
            >
              <h4 className="font-semibold">Preset preview</h4>
              <p className="text-sm">
                Replace the entire trigger configuration with the following editable fields.
                Connections stay as they are. Undo restores the current configuration and unfinished
                input.
              </p>
              {heldInputs && Object.keys(heldInputs).length ? (
                <p role="alert">
                  Unfinished input will be replaced:{' '}
                  {Object.keys(heldInputs)
                    .map((path) => triggerFieldLabel(config, path))
                    .join(', ')}
                  .
                </p>
              ) : null}
              <p id={`${id}-current-label`} className="text-sm font-semibold">
                Current configuration
              </p>
              <pre
                role="region"
                aria-labelledby={`${id}-current-label`}
                tabIndex={0}
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs"
              >
                {JSON.stringify(config, null, 2)}
              </pre>
              <p id={`${id}-preset-label`} className="text-sm font-semibold">
                Preset configuration
              </p>
              <pre
                role="region"
                aria-labelledby={`${id}-preset-label`}
                tabIndex={0}
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs"
              >
                {JSON.stringify(activePreview.replacement, null, 2)}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setPreview(undefined);
                    requestAnimationFrame(() => previewButtonRef.current?.focus());
                  }}
                >
                  Cancel preview
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onApply(activePreview.replacement);
                    setPreview(undefined);
                  }}
                >
                  Apply GitHub preset
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
