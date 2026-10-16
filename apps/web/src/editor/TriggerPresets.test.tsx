import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Buffer } from 'node:buffer';
import { runInNewContext } from 'node:vm';
import { TriggerConfigSchema, type NodeInput } from '@graphgoblin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { manualTriggerConfig, triggerConfig } from '../__fixtures__/triggers.js';
import { TriggerPresets as PresetPanel } from './TriggerPresets.js';
import { newLoopDefinition } from './model.js';
import { previewGitHubPreset } from './github-fragment.js';
import { useMemo, type ComponentProps } from 'react';
import { canApplyGitHubPreset, validGitHubRepository } from './trigger-presets.js';

function TriggerPresets(
  props: Omit<ComponentProps<typeof PresetPanel>, 'definition' | 'triggerId'>,
) {
  const definition = useMemo(() => {
    const def = newLoopDefinition('preset');
    def.nodes[0] = { ...def.nodes[0]!, config: props.config } as NodeInput;
    return def;
  }, [props.config]);
  return <PresetPanel {...props} definition={definition} triggerId="start" />;
}

interface GhSpawnOptions {
  encoding: string;
  maxBuffer: number;
  timeout: number;
  windowsHide: boolean;
  shell: boolean;
}

interface GhSpawnResult {
  status: number | null;
  stdout: string;
  error?: Error | undefined;
}

function executeGhProgram(program: string, result: GhSpawnResult) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let spawn: { command: string; args: string[]; options: GhSpawnOptions } | undefined;
  let thrown: unknown;
  const childProcess = {
    spawnSync: (command: string, args: string[], options: GhSpawnOptions) => {
      spawn = { command, args, options };
      return result;
    },
  };
  const fakeProcess = {
    stdout: { write: (value: string): void => void stdout.push(value) },
    stderr: { write: (value: string): void => void stderr.push(value) },
    exit: (code: number): never => {
      throw new Error(`exit:${code}`);
    },
  };
  try {
    runInNewContext(
      program,
      {
        Buffer,
        process: fakeProcess,
        require: (specifier: string) => {
          if (specifier !== 'node:child_process')
            throw new Error(`unexpected module: ${specifier}`);
          return childProcess;
        },
      },
      { timeout: 1000 },
    );
  } catch (error) {
    thrown = error;
  }
  return { stdout: stdout.join(''), stderr: stderr.join(''), spawn, thrown };
}

describe('TriggerPresets', () => {
  it.each([false, true])(
    'previews poll removal or retained-check warning (shared: %s)',
    async (shared) => {
      const setup = {
        owner: 'octo',
        repository: 'service',
        label: 'ready',
        baseBranch: '',
        secretRef: 'hook',
      };
      const definition = previewGitHubPreset(
        newLoopDefinition('poll conversion'),
        'start',
        'issues-labeled',
        setup,
      ).definition;
      definition.nodes.find((node) => node.id === 'event-check')!.label = 'Owner edited check';
      if (shared) {
        definition.nodes.push({
          id: 'shared-start',
          kind: 'trigger',
          label: 'Shared',
          config: manualTriggerConfig(),
        });
        definition.edges.push({
          id: 'shared-edge',
          from: { node: 'shared-start', port: 'out' },
          to: { node: 'restore-output' },
        });
      }
      const original = JSON.stringify(definition);
      const onApply = vi.fn();
      render(
        <PresetPanel
          definition={definition}
          triggerId="start"
          config={definition.nodes[0]!.config}
          onApply={onApply}
        />,
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Start from a preset' }));
      await user.selectOptions(screen.getByLabelText('Preset'), 'issues-poll');
      await user.type(screen.getByLabelText('Repository owner'), 'octo');
      await user.type(screen.getByLabelText('Repository'), 'service');
      await user.type(screen.getByLabelText('Issue label'), 'ready');
      const previewButton = screen.getByRole('button', { name: 'Preview GitHub preset' });
      await user.click(previewButton);
      const preview = screen.getByRole('region', { name: 'Preset preview' });
      if (shared) {
        expect(preview).toHaveTextContent(
          'existing downstream check stays in place and may ignore poll results',
        );
        expect(preview).not.toHaveTextContent('Remove the existing check/restore/exit fragment');
      } else {
        expect(preview).toHaveTextContent('Remove the existing check/restore/exit fragment');
        expect(preview).toHaveTextContent('reconnect its former successor directly to the trigger');
        expect(preview).toHaveTextContent('Owner edited check');
      }
      await user.click(screen.getByRole('button', { name: 'Cancel preview' }));
      expect(JSON.stringify(definition)).toBe(original);
      expect(onApply).not.toHaveBeenCalled();
      await user.click(previewButton);
      await user.click(screen.getByRole('button', { name: 'Apply GitHub preset' }));
      expect(onApply).toHaveBeenCalledWith(
        expect.objectContaining({
          removedNodes: shared
            ? []
            : expect.arrayContaining([expect.objectContaining({ id: 'event-check' })]),
          rewiredEdges: shared
            ? []
            : [expect.objectContaining({ id: 'e1', from: { node: 'start', port: 'out' } })],
        }),
      );
    },
  );

  it.each(['definition', 'draftInputs', 'generation'] as const)(
    'invalidates a graph preview when %s changes',
    async (changed) => {
      const user = userEvent.setup();
      const definition = newLoopDefinition('stale graph');
      const props = {
        definition,
        triggerId: 'start',
        config: definition.nodes[0]!.config,
        draftInputs: {},
        generation: 1,
        onApply: vi.fn(),
      };
      const { rerender } = render(<PresetPanel {...props} />);
      await user.click(screen.getByRole('button', { name: 'Start from a preset' }));
      await user.selectOptions(screen.getByLabelText('Preset'), 'issues-poll');
      await user.type(screen.getByLabelText('Repository owner'), 'octo');
      await user.type(screen.getByLabelText('Repository'), 'service');
      await user.type(screen.getByLabelText('Issue label'), 'ready');
      await user.click(screen.getByRole('button', { name: 'Preview GitHub preset' }));
      rerender(
        <PresetPanel
          {...props}
          definition={changed === 'definition' ? { ...definition, name: 'changed' } : definition}
          draftInputs={
            changed === 'draftInputs'
              ? { 'node:done': { returns: { text: '(', message: 'held' } } }
              : props.draftInputs
          }
          generation={changed === 'generation' ? 2 : 1}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Apply GitHub preset' })).not.toBeInTheDocument();
    },
  );

  it('explicitly reviews replacement of owner edits and held text, and surfaces an apply refusal', async () => {
    const setup = {
      owner: 'octo',
      repository: 'service',
      label: 'ready',
      baseBranch: '',
      secretRef: 'hook',
    };
    const definition = previewGitHubPreset(
      newLoopDefinition('replacement'),
      'start',
      'issues-labeled',
      setup,
    ).definition;
    definition.nodes.find((node) => node.id === 'event-check')!.label = 'Owner edited check';
    const onApply = vi.fn(() => 'The draft changed. Preview again.');
    render(
      <PresetPanel
        config={definition.nodes[0]!.config}
        definition={definition}
        triggerId="start"
        draftInputs={{
          'node:event-check': { jsonata: { text: 'unfinished-owner-expression', message: 'held' } },
        }}
        onApply={onApply}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Start from a preset' }));
    await user.selectOptions(screen.getByLabelText('Preset'), 'issues-labeled');
    await user.type(screen.getByLabelText('Repository owner'), 'octo');
    await user.type(screen.getByLabelText('Repository'), 'service');
    await user.type(screen.getByLabelText('Issue label'), 'ready');
    await user.type(screen.getByLabelText('Signing secret name'), 'hook');
    await user.click(screen.getByRole('button', { name: 'Preview GitHub preset' }));
    const preview = screen.getByRole('region', { name: 'Preset preview' });
    expect(preview).toHaveTextContent('including all owner edits');
    expect(preview).toHaveTextContent('Owner edited check');
    expect(preview).toHaveTextContent('unfinished-owner-expression');
    await user.click(screen.getByRole('button', { name: 'Apply GitHub preset' }));
    expect(screen.getByText('The draft changed. Preview again.')).toHaveAttribute('role', 'alert');
    expect(definition.nodes).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Cancel preview' }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('shows editor captions and row numbers for held Poll fields', async () => {
    const user = userEvent.setup();
    render(
      <TriggerPresets
        config={triggerConfig('poll', {
          intervalSeconds: 60,
          probe: { kind: 'none' },
          fireWhen: 'true',
        })}
        heldInputs={{
          intervalSeconds: {},
          'items.dedupeKey': {},
          'items.maxRunsPerPoll': {},
          'probe.args.0': {},
        }}
        onApply={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Start from a preset' }));
    await user.selectOptions(screen.getByLabelText('Preset'), 'issues-poll');
    await user.type(screen.getByLabelText('Repository owner'), 'octo');
    await user.type(screen.getByLabelText('Repository'), 'service');
    await user.type(screen.getByLabelText('Issue label'), 'ready');
    await user.click(screen.getByRole('button', { name: 'Preview GitHub preset' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unfinished input will be replaced: Interval seconds, Per-item dedupe key, Items Max runs per poll, Probe Args 1.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('items.dedupeKey');
  });

  it.each(['config', 'heldInputs', 'historyEpoch'] as const)(
    'invalidates a preview after the current %s changes',
    async (changed) => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      const props = { config: manualTriggerConfig(), heldInputs: {}, historyEpoch: 0, onApply };
      const { rerender } = render(<TriggerPresets {...props} />);
      expect(screen.queryByRole('form', { name: 'GitHub preset setup' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Start from a preset' }));
      await user.selectOptions(screen.getByLabelText('Preset'), 'issues-poll');
      expect(screen.getByRole('button', { name: 'Preview GitHub preset' })).toBeDisabled();
      await user.type(screen.getByLabelText('Repository owner'), 'octo');
      await user.type(screen.getByLabelText('Repository'), 'service');
      await user.type(screen.getByLabelText('Issue label'), 'ready');
      await user.click(screen.getByRole('button', { name: 'Preview GitHub preset' }));
      expect(screen.getByRole('region', { name: 'Preset preview' })).toBeVisible();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      rerender(
        <TriggerPresets
          {...props}
          {...{
            config: changed === 'config' ? manualTriggerConfig() : props.config,
            heldInputs:
              changed === 'heldInputs'
                ? { inputSchema: { text: '{unfinished' } }
                : props.heldInputs,
            historyEpoch: changed === 'historyEpoch' ? 1 : props.historyEpoch,
          }}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Apply GitHub preset' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Preview GitHub preset' })).toBeEnabled();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Preset preview is out of date. Preview the preset again before applying.',
      );
      expect(onApply).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Preview GitHub preset' }));
      expect(screen.getByRole('region', { name: 'Preset preview' })).toBeVisible();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    },
  );

  it('keeps setup optional and requires explicit branch and signing values for a PR preset', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<TriggerPresets config={manualTriggerConfig()} onApply={onApply} />);
    const toggle = screen.getByRole('button', { name: 'Start from a preset' });
    await user.click(toggle);
    await user.selectOptions(screen.getByLabelText('Preset'), 'pull-request-ready');
    expect(screen.queryByLabelText('Issue label')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Repository owner'), 'octo');
    await user.type(screen.getByLabelText('Repository'), 'service');
    await user.type(screen.getByLabelText('Pull request base branch'), 'main');
    expect(screen.getByRole('button', { name: 'Preview GitHub preset' })).toBeDisabled();
    await user.type(screen.getByLabelText('Signing secret name'), 'repo-hook');
    await user.click(screen.getByRole('button', { name: 'Preview GitHub preset' }));
    expect(screen.getByRole('region', { name: 'Preset preview' })).toHaveTextContent('repo-hook');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Preset preview' })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    await user.click(toggle);
    expect(screen.getByLabelText('Pull request base branch')).toHaveValue('main');
    expect(screen.queryByRole('button', { name: 'Apply GitHub preset' })).not.toBeInTheDocument();
  });

  it('previews a signed issue-label graph without changing the trigger until apply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<TriggerPresets config={manualTriggerConfig()} onApply={onApply} />);
    await user.click(screen.getByRole('button', { name: 'Start from a preset' }));
    await user.selectOptions(screen.getByLabelText('Preset'), 'issues-labeled');
    await user.type(screen.getByLabelText('Repository owner'), 'octo-team');
    await user.type(screen.getByLabelText('Repository'), 'service_repo');
    await user.type(screen.getByLabelText('Issue label'), 'Ready "now"');
    await user.type(screen.getByLabelText('Signing secret name'), 'github-hook');
    await user.click(screen.getByRole('button', { name: 'Preview GitHub preset' }));
    expect(onApply).not.toHaveBeenCalled();
    const preview = screen.getByRole('region', { name: 'Preset preview' });
    expect(preview).toHaveFocus();
    expect(preview).toHaveTextContent('event-check');
    expect(preview).toHaveTextContent('restore-output');
    expect(preview).toHaveTextContent('quiet-exit');
    expect(preview).toHaveTextContent('rewireEdges');
    await user.click(screen.getByRole('button', { name: 'Apply GitHub preset' }));
    expect(onApply.mock.calls[0]?.[0].definition.nodes[0].config).toMatchObject({
      type: 'webhook',
      signature: { scheme: 'hmac-sha256-body', secretRef: 'github-hook' },
      dedupeKey: '$headers."x-github-delivery"',
    });
    expect(onApply.mock.calls[0]?.[0].definition.nodes[0].config).not.toHaveProperty('filter');
  });

  it('creates a bounded GitHub issue poll and encodes the query label as one argument', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<TriggerPresets config={manualTriggerConfig()} onApply={onApply} />);

    await user.click(screen.getByRole('button', { name: 'Start from a preset' }));
    await user.selectOptions(screen.getByLabelText('Preset'), 'issues-poll');
    await user.type(screen.getByLabelText('Repository owner'), 'octo');
    await user.type(screen.getByLabelText('Repository'), 'service');
    await user.type(screen.getByLabelText('Issue label'), 'ready for review');
    expect(screen.queryByLabelText('Signing secret name')).not.toBeInTheDocument();
    expect(screen.getByText(/rejects output over 200 issues or 64 KiB/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Preview GitHub preset' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Preset preview' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Apply GitHub preset' }));

    const config = onApply.mock.calls[0]?.[0].definition.nodes[0].config as Record<string, unknown>;
    expect(config).toMatchObject({
      type: 'poll',
      intervalSeconds: 60,
      fireWhen: 'true',
      items: {
        select: 'probe.json',
        dedupeKey: '"octo/service:issue:" & $string(item.number)',
        maxRunsPerPoll: 5,
      },
    });
    const probe = config['probe'] as { command: string; args: string[] };
    expect(probe.command).toBe('node');
    expect(probe.args[0]).toBe('-e');
    const program = probe.args[1]!;
    expect(program).toContain("spawnSync('gh'");
    expect(program).toContain("'--paginate'");
    expect(program).toContain("'--jq'");
    expect(program).toContain('ready%20for%20review');
    expect(program).toContain('@json');
    expect(program).toContain('maxBuffer:65536');
    expect(program).toContain('timeout:55000');
    expect(program).toContain('shell:false');
    expect(program).toContain('lines.length>200');
    expect(program).toContain("Buffer.byteLength(output,'utf8')>65536");
    expect(program).not.toContain('--slurp');

    const parsed = TriggerConfigSchema.parse(config);
    if (parsed.type !== 'poll' || parsed.probe.kind !== 'script')
      throw new Error('The poll preset did not produce a script probe.');
    const curated = [
      {
        number: 17,
        title: 'first',
        updated_at: '2026-10-07T12:00:00Z',
        url: 'https://github.com/a/1',
      },
      {
        number: 18,
        title: 'second',
        updated_at: '2026-10-07T12:01:00Z',
        url: 'https://github.com/a/2',
      },
    ];
    const execution = executeGhProgram(parsed.probe.args[1]!, {
      status: 0,
      stdout: `${JSON.stringify(curated[0])}\r\n${JSON.stringify(curated[1])}\r\n`,
    });
    expect(execution.thrown).toBeUndefined();
    expect(JSON.parse(execution.stdout)).toEqual(curated);
    expect(execution.spawn).toMatchObject({
      command: 'gh',
      args: expect.arrayContaining(['--paginate', '--jq']),
      options: {
        encoding: 'utf8',
        maxBuffer: 65_536,
        timeout: 55_000,
        windowsHide: true,
        shell: false,
      },
    });

    const failed = executeGhProgram(parsed.probe.args[1]!, {
      status: 1,
      stdout: '',
      error: new Error('private credential text'),
    });
    expect(String(failed.thrown)).toContain('exit:1');
    expect(failed.stderr).toBe('GitHub poll failed or exceeded limits');
    expect(failed.stderr).not.toContain('private credential text');
    expect(failed.stdout).toBe('');
  });

  it('discloses an unknown stored signing scheme without applying a replacement', () => {
    const onApply = vi.fn();
    render(
      <TriggerPresets
        config={{ type: 'webhook', signature: { scheme: 'custom-hmac', secretRef: 'saved' } }}
        onApply={onApply}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('custom-hmac');
    expect(screen.getByRole('alert')).toHaveTextContent('value is preserved');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('rejects repository path separators before composing the local gh command', () => {
    expect(validGitHubRepository('octo/team', 'service')).toBe(false);
    expect(validGitHubRepository('octo', '../service')).toBe(false);
    expect(
      canApplyGitHubPreset('issues-poll', {
        owner: 'octo/team',
        repository: 'service',
        label: 'ready',
        baseBranch: '',
        secretRef: '',
      }),
    ).toBe(false);
  });
});
