import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Buffer } from 'node:buffer';
import { runInNewContext } from 'node:vm';
import { TriggerConfigSchema } from '@graphgoblin/contracts';
import { evaluatePredicate } from '@graphgoblin/domain';
import { describe, expect, it, vi } from 'vitest';
import { TriggerPresets } from './TriggerPresets.js';
import {
  canApplyGitHubPreset,
  makeGitHubTriggerPreset,
  validGitHubRepository,
} from './trigger-presets.js';

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
  it('builds an editable body-signed issue-label filter from explicit setup values', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<TriggerPresets config={{ subtype: 'manual' }} onApply={onApply} />);

    await user.selectOptions(screen.getByLabelText('Preset'), 'issues-labeled');
    await user.type(screen.getByLabelText('Repository owner'), 'octo-team');
    await user.type(screen.getByLabelText('Repository'), 'service_repo');
    await user.type(screen.getByLabelText('Issue label'), 'Ready "now"');
    await user.type(screen.getByLabelText('Signing secret name'), 'github-hook');
    expect(screen.getByRole('button', { name: 'Apply GitHub preset' })).toBeEnabled();
    expect(screen.getByText(/signature authenticates the exact request body/i)).toBeVisible();
    expect(screen.getByText(/raw body independently of that ID/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Apply GitHub preset' }));
    expect(onApply).toHaveBeenCalledWith({
      subtype: 'webhook',
      signature: {
        scheme: 'hmac-sha256-body',
        header: 'x-hub-signature-256',
        secretRef: 'github-hook',
      },
      dedupeKey: '$headers."x-github-delivery"',
      filter:
        'repository.full_name = "octo-team/service_repo" and action = "labeled" and $exists(issue) and $not($exists(issue.pull_request)) and label.name = "Ready \\"now\\""',
    });
  });

  it('parses presets and evaluates issue and pull-request filters against sample payloads', async () => {
    const setup = {
      owner: 'octo-team',
      repository: 'service_repo',
      label: 'Ready "now"',
      baseBranch: 'release "candidate"',
      secretRef: 'github-hook',
    };
    const bindings = { bindings: { headers: {} } };
    const issuePayload = (repository: string, action: string, label: string) => ({
      repository: { full_name: repository },
      action,
      issue: { number: 17, title: 'Synthetic issue' },
      label: { name: label },
    });
    const readyPayload = (action: string, draft: boolean, base: string) => ({
      repository: { full_name: 'octo-team/service_repo' },
      action,
      pull_request: { draft, merged: false, base: { ref: base } },
    });

    const issue = TriggerConfigSchema.parse(makeGitHubTriggerPreset('issues-labeled', setup));
    if (issue.subtype !== 'webhook' || !issue.filter)
      throw new Error('The issue-label preset did not produce a filtered webhook.');
    expect(issue.signature.scheme).toBe('hmac-sha256-body');
    expect(issue).not.toHaveProperty('replayWindowSeconds');
    expect(
      await evaluatePredicate(
        issue.filter,
        issuePayload('octo-team/service_repo', 'labeled', 'Ready "now"'),
        bindings,
      ),
    ).toBe(true);
    expect(
      await evaluatePredicate(
        issue.filter,
        issuePayload('another-team/service_repo', 'labeled', 'Ready "now"'),
        bindings,
      ),
    ).toBe(false);
    expect(
      await evaluatePredicate(
        issue.filter,
        issuePayload('octo-team/service_repo', 'labeled', 'other'),
        bindings,
      ),
    ).toBe(false);
    expect(
      await evaluatePredicate(
        issue.filter,
        issuePayload('octo-team/service_repo', 'ping', 'Ready "now"'),
        bindings,
      ),
    ).toBe(false);

    const ready = TriggerConfigSchema.parse(makeGitHubTriggerPreset('pull-request-ready', setup));
    if (ready.subtype !== 'webhook' || !ready.filter)
      throw new Error('The ready pull-request preset did not produce a filtered webhook.');
    for (const action of ['opened', 'ready_for_review'])
      expect(
        await evaluatePredicate(
          ready.filter,
          readyPayload(action, false, setup.baseBranch),
          bindings,
        ),
      ).toBe(true);
    expect(
      await evaluatePredicate(
        ready.filter,
        readyPayload('opened', true, setup.baseBranch),
        bindings,
      ),
    ).toBe(false);
    expect(
      await evaluatePredicate(ready.filter, readyPayload('opened', false, 'main'), bindings),
    ).toBe(false);

    const merged = TriggerConfigSchema.parse(makeGitHubTriggerPreset('pull-request-merged', setup));
    if (merged.subtype !== 'webhook' || !merged.filter)
      throw new Error('The merged pull-request preset did not produce a filtered webhook.');
    expect(
      await evaluatePredicate(
        merged.filter,
        {
          ...readyPayload('closed', false, setup.baseBranch),
          pull_request: { draft: false, merged: true, base: { ref: setup.baseBranch } },
        },
        bindings,
      ),
    ).toBe(true);
    expect(
      await evaluatePredicate(
        merged.filter,
        readyPayload('closed', false, setup.baseBranch),
        bindings,
      ),
    ).toBe(false);
    expect(
      await evaluatePredicate(
        merged.filter,
        {
          ...readyPayload('closed', false, 'main'),
          pull_request: { draft: false, merged: true, base: { ref: 'main' } },
        },
        bindings,
      ),
    ).toBe(false);
  });

  it('creates a bounded GitHub issue poll and encodes the query label as one argument', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<TriggerPresets config={{ subtype: 'manual' }} onApply={onApply} />);

    await user.selectOptions(screen.getByLabelText('Preset'), 'issues-poll');
    await user.type(screen.getByLabelText('Repository owner'), 'octo');
    await user.type(screen.getByLabelText('Repository'), 'service');
    await user.type(screen.getByLabelText('Issue label'), 'ready for review');
    expect(screen.queryByLabelText('Signing secret name')).not.toBeInTheDocument();
    expect(screen.getByText(/rejects output over 200 issues or 64 KiB/i)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Apply GitHub preset' }));

    const config = onApply.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config).toMatchObject({
      subtype: 'poll',
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
    if (parsed.subtype !== 'poll' || parsed.probe.kind !== 'script')
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
        config={{ subtype: 'webhook', signature: { scheme: 'custom-hmac', secretRef: 'saved' } }}
        onApply={onApply}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('custom-hmac');
    expect(screen.getByRole('alert')).toHaveTextContent('value is preserved');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('builds body-checked pull request filters and safely quotes the configured branch', () => {
    const setup = {
      owner: 'octo-team',
      repository: 'service',
      label: '',
      baseBranch: 'release "candidate"',
      secretRef: 'pr-hook',
    };
    expect(canApplyGitHubPreset('pull-request-ready', setup)).toBe(true);
    const ready = makeGitHubTriggerPreset('pull-request-ready', setup);
    const merged = makeGitHubTriggerPreset('pull-request-merged', setup);

    expect(ready['filter']).toContain('action in ["opened", "ready_for_review"]');
    expect(ready['filter']).toContain('$exists(pull_request)');
    expect(ready['filter']).toContain('pull_request.draft = false');
    expect(ready['filter']).toContain(
      `pull_request.base.ref = ${JSON.stringify(setup.baseBranch)}`,
    );
    expect(merged['filter']).toContain('action = "closed"');
    expect(merged['filter']).toContain('pull_request.merged = true');
    expect(merged['filter']).toContain(
      `pull_request.base.ref = ${JSON.stringify(setup.baseBranch)}`,
    );
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
