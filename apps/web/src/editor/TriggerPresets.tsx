import { useId, useState, type FormEvent } from 'react';
import { Button, FieldGroup, HelpText, Input, Label, Select } from '../components/ui/index.js';
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
  onApply,
}: {
  config: unknown;
  onApply: (config: Record<string, unknown>) => void;
}) {
  const id = useId();
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
    if (preset && canApply) onApply(makeGitHubTriggerPreset(preset, setup));
  };

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="grid gap-3 rounded-lg border border-default bg-surface-subtle p-3"
    >
      <div className="grid gap-1">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          GitHub starter config
        </h3>
        <p className="text-xs text-muted">
          Apply a setup, then edit its trigger fields below. GraphGoblin does not call GitHub from
          this editor.
        </p>
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

      <form aria-label="GitHub preset setup" onSubmit={submit} className="grid gap-3">
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
            The signature authenticates the exact request body. GitHub event and delivery headers
            are unsigned hints; the delivery ID is only a business dedupe key. Exact replay
            suppression uses the raw body independently of that ID.
          </p>
        ) : null}
        {preset === 'issues-poll' ? (
          <p className="rounded-md border border-default bg-surface px-3 py-2 text-xs text-muted">
            This read-only poll uses an already-installed, authenticated local <code>gh</code>{' '}
            command. It rejects output over 200 issues or 64 KiB, then admits up to 5 unseen items
            per poll by default; all bounds and expressions remain editable below.
          </p>
        ) : null}

        {preset ? (
          <div>
            <Button type="submit" size="sm" disabled={!canApply}>
              Apply GitHub preset
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
