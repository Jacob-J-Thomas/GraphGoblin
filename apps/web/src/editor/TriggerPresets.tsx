import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { Button, FieldGroup, HelpText, Input, Label, Select } from '../components/ui/index.js';
import { previewGitHubPreset, type GitHubPresetPreview } from './github-fragment.js';
import type { FieldErrors } from './history.js';
import {
  canApplyGitHubPreset,
  GITHUB_TRIGGER_PRESETS,
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
  definition,
  triggerId,
  draftInputs,
  generation,
  heldInputs,
  historyEpoch,
  onApply,
}: {
  config: unknown;
  definition: LoopDefinitionInput;
  triggerId: string;
  draftInputs?: FieldErrors | undefined;
  generation?: number | undefined;
  heldInputs?: Record<string, unknown> | undefined;
  historyEpoch?: number | undefined;
  onApply: (preview: GitHubPresetPreview) => string | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const previewRegionRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{
    config: unknown;
    heldInputs: typeof heldInputs;
    historyEpoch: typeof historyEpoch;
    replacement: GitHubPresetPreview;
    draftInputs: typeof draftInputs;
    generation: typeof generation;
  }>();
  const activePreview =
    preview?.config === config &&
    preview?.heldInputs === heldInputs &&
    preview?.historyEpoch === historyEpoch &&
    preview?.replacement.source === definition &&
    preview?.draftInputs === draftInputs &&
    preview?.generation === generation
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
    setError(undefined);
    if (preset && canApply)
      setPreview({
        config,
        heldInputs,
        historyEpoch,
        draftInputs,
        generation,
        replacement: previewGitHubPreset(definition, triggerId, preset, setup),
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
            Choose an optional GitHub starting point, preview it, then edit its fields and nodes.
            Applying replaces the trigger configuration and applies the shown graph in one undoable
            edit. GraphGoblin does not call GitHub from this editor.
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
                          : 'The label name is encoded safely in the event-check decision.'}
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
                      <HelpText>The decision checks the signed pull request body.</HelpText>
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
                Replace the entire trigger configuration. Changed fields:{' '}
                {activePreview.replacement.fields.join(', ') || 'none'}. Undo restores the graph and
                unfinished input.
              </p>
              {activePreview.replacement.removedNodes.length ? (
                <div className="grid gap-2">
                  <p role="alert">
                    {activePreview.replacement.addedNodes.length
                      ? 'Replace the existing check/restore/exit fragment, including all owner edits shown below.'
                      : 'Remove the existing check/restore/exit fragment, including all owner edits shown below, and reconnect its former successor directly to the trigger.'}
                  </p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(
                      {
                        unfinishedInputToReplace: Object.fromEntries(
                          activePreview.replacement.removedNodes.map((node) => [
                            `node:${node.id}`,
                            draftInputs?.[`node:${node.id}`],
                          ]),
                        ),
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ) : activePreview.replacement.addedNodes.length ? (
                <p>
                  Insert an editable check/restore/quiet-exit fragment. Existing downstream nodes
                  are retained.
                </p>
              ) : null}
              {heldInputs && Object.keys(heldInputs).length ? (
                <p role="alert">
                  Unfinished input will be replaced: {Object.keys(heldInputs).join(', ')}.
                </p>
              ) : null}
              <p className="text-sm font-semibold">Current configuration</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(config, null, 2)}
              </pre>
              <p className="text-sm font-semibold">Preset configuration</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(
                  activePreview.replacement.definition.nodes.find((node) => node.id === triggerId)!
                    .config,
                  null,
                  2,
                )}
              </pre>
              <p className="text-sm font-semibold">Nodes and edges to add, replace or rewire</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(
                  {
                    removeNodes: activePreview.replacement.removedNodes,
                    removeEdges: activePreview.replacement.removedEdges,
                    addNodes: activePreview.replacement.addedNodes,
                    addEdges: activePreview.replacement.addedEdges,
                    rewireEdges: activePreview.replacement.rewiredEdges.map((edge) => ({
                      before: definition.edges.find((old) => old.id === edge.id),
                      after: edge,
                    })),
                  },
                  null,
                  2,
                )}
              </pre>
              {activePreview.replacement.issues.map((issue, index) => (
                <p key={index} role={issue.severity === 'error' ? 'alert' : undefined}>
                  {issue.message}
                </p>
              ))}
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
                  disabled={activePreview.replacement.issues.some(
                    (issue) => issue.severity === 'error',
                  )}
                  onClick={() => {
                    const problem = onApply(activePreview.replacement);
                    setError(problem);
                    if (!problem) setPreview(undefined);
                  }}
                >
                  Apply GitHub preset
                </Button>
              </div>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
