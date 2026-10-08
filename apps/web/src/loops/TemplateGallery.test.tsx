import {
  ImplementationTemplateSettingsSchema,
  QaTemplateSettingsSchema,
  ReviewTemplateSettingsSchema,
  TemplateInstantiateResponseSchema,
  type ModelCatalogEntry,
  type TemplateSettings,
} from '@graphgoblin/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  id,
  implementationTemplateEntry,
  qaTemplateEntry,
  reviewTemplateEntry,
  starterTemplateEntry,
  TS,
} from '../__fixtures__/fake-api.js';
import { TemplateGallery, type TemplateRolePreflight } from './TemplateGallery.js';

const model: ModelCatalogEntry = {
  harness: 'codex',
  model: 'test-codex',
  source: 'harness',
  displayName: 'Test Codex',
  efforts: ['low'],
  defaultEffort: 'low',
  enabled: true,
};

const readyCodex = [{ harness: 'codex', ok: true, authenticated: true, problems: [] }];

function implementationResponse(
  entry: ReturnType<typeof implementationTemplateEntry>,
  settings: Extract<TemplateSettings, { kind: 'implementation' }>,
) {
  const parentLoopId = id('implementation-parent');
  return TemplateInstantiateResponseSchema.parse({
    instance: {
      id: id('implementation-instance'),
      ownerId: 'local',
      templateId: entry.manifest.id,
      templateVersion: entry.manifest.version,
      createdAt: TS,
      parentLoopId,
      loops: [
        {
          key: entry.manifest.parentKey,
          loopId: parentLoopId,
          versionId: id('implementation-draft'),
          version: 1,
          status: 'draft',
        },
      ],
      settings,
    },
    prerequisites: entry.prerequisites,
  });
}

function reviewResponse(
  entry: ReturnType<typeof reviewTemplateEntry>,
  settings: Extract<TemplateSettings, { kind: 'review' }>,
  parentLoopId = id('review-parent'),
) {
  return TemplateInstantiateResponseSchema.parse({
    instance: {
      id: id('review-instance'),
      ownerId: 'local',
      templateId: entry.manifest.id,
      templateVersion: entry.manifest.version,
      createdAt: TS,
      parentLoopId,
      loops: [
        {
          key: entry.manifest.parentKey,
          loopId: parentLoopId,
          versionId: id('review-draft'),
          version: 1,
          status: 'draft',
        },
      ],
      settings,
    },
    prerequisites: entry.prerequisites,
  });
}

function qaResponse(
  entry: ReturnType<typeof qaTemplateEntry>,
  settings: Extract<TemplateSettings, { kind: 'qa' }>,
) {
  const parentLoopId = id('qa-parent');
  return TemplateInstantiateResponseSchema.parse({
    instance: {
      id: id('qa-instance'),
      ownerId: 'local',
      templateId: entry.manifest.id,
      templateVersion: entry.manifest.version,
      createdAt: TS,
      parentLoopId,
      loops: entry.manifest.loops.map((loop) => ({
        key: loop.key,
        loopId: loop.key === entry.manifest.parentKey ? parentLoopId : id(`qa-${loop.key}`),
        versionId: id(`qa-${loop.key}-version`),
        version: 1,
        status: loop.key === entry.manifest.parentKey ? 'draft' : 'published',
      })),
      settings,
    },
    prerequisites: entry.prerequisites,
  });
}

async function openQaTemplate(
  entry: ReturnType<typeof qaTemplateEntry>,
  models: readonly ModelCatalogEntry[] = [model],
  preflight: readonly TemplateRolePreflight[] = readyCodex,
  onCheckPrerequisites: (
    templateId: string,
    settings: TemplateSettings,
  ) => Promise<ReturnType<typeof qaTemplateEntry>['prerequisites']> = () =>
    Promise.resolve(entry.prerequisites),
  onInstantiate: (
    templateId: string,
    settings: TemplateSettings,
  ) => Promise<ReturnType<typeof qaResponse>> = (_templateId, settings) =>
    Promise.resolve(qaResponse(entry, QaTemplateSettingsSchema.parse(settings))),
  onCreated: (parentLoopId: string) => void | Promise<void> = () => undefined,
) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/loops']}>
      <TemplateGallery
        templates={[entry]}
        models={models}
        preflight={preflight}
        onCheckPrerequisites={onCheckPrerequisites}
        onInstantiate={onInstantiate}
        onCreated={onCreated}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'New from template' }));
  await user.click(screen.getByRole('button', { name: 'Use Post-merge QA' }));
  return user;
}

async function fillQaRepository(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Checkout path' }), 'C:/repos/qa-project');
  await user.type(screen.getByRole('textbox', { name: 'Repository owner' }), 'ExampleOrg');
  await user.type(screen.getByRole('textbox', { name: 'Repository name' }), 'qa-project');
  await user.type(screen.getByRole('textbox', { name: 'Base branch' }), 'main');
}

async function openImplementationTemplate(
  user: ReturnType<typeof userEvent.setup>,
  entry = implementationTemplateEntry(),
  models: readonly ModelCatalogEntry[] = [model],
  preflight: readonly {
    harness: string;
    ok: boolean;
    authenticated: boolean;
    problems: string[];
  }[] = readyCodex,
  onCheckPrerequisites: (
    templateId: string,
    settings: TemplateSettings,
  ) => Promise<ReturnType<typeof implementationTemplateEntry>['prerequisites']> = () =>
    Promise.resolve(entry.prerequisites),
  onInstantiate: (
    templateId: string,
    settings: TemplateSettings,
  ) => Promise<ReturnType<typeof implementationResponse>> = (_templateId, settings) =>
    Promise.resolve(
      implementationResponse(entry, ImplementationTemplateSettingsSchema.parse(settings)),
    ),
) {
  render(
    <MemoryRouter initialEntries={['/loops']}>
      <TemplateGallery
        templates={[entry]}
        models={models}
        preflight={preflight}
        onCheckPrerequisites={onCheckPrerequisites}
        onInstantiate={onInstantiate}
        onCreated={() => undefined}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'New from template' }));
  await user.click(screen.getByRole('button', { name: 'Use Implementation workflow' }));
  return entry;
}

async function fillImplementationSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: 'Checkout path' }), 'C:/repos/graphgoblin');
  await user.type(screen.getByRole('textbox', { name: 'Repository owner' }), 'GraphGoblinOrg');
  await user.type(screen.getByRole('textbox', { name: 'Repository name' }), 'GraphGoblin');
  await user.type(screen.getByRole('textbox', { name: 'Base branch' }), 'main');
  await user.type(screen.getByRole('textbox', { name: 'Program' }), '.cmd');
  const args = screen.getByRole('textbox', { name: 'Arguments, one per line' });
  await user.clear(args);
  await user.type(args, 'check{Enter}test:coverage');
  await user.clear(screen.getByRole('spinbutton', { name: 'Timeout in seconds' }));
  await user.type(screen.getByRole('spinbutton', { name: 'Timeout in seconds' }), '120');
  await user.clear(screen.getByRole('textbox', { name: 'Trigger label' }));
  await user.type(screen.getByRole('textbox', { name: 'Trigger label' }), 'ready-to-build');
  await user.clear(screen.getByRole('textbox', { name: 'In-progress label' }));
  await user.type(screen.getByRole('textbox', { name: 'In-progress label' }), 'building');
  await user.clear(screen.getByRole('textbox', { name: 'Pull request open label' }));
  await user.type(screen.getByRole('textbox', { name: 'Pull request open label' }), 'review-open');
  await user.clear(screen.getByRole('textbox', { name: 'Blocked label' }));
  await user.type(screen.getByRole('textbox', { name: 'Blocked label' }), 'needs-help');
  await user.clear(screen.getByRole('spinbutton', { name: 'Maximum tasks' }));
  await user.type(screen.getByRole('spinbutton', { name: 'Maximum tasks' }), '12');
  await user.clear(screen.getByRole('spinbutton', { name: 'Gate fixes' }));
  await user.type(screen.getByRole('spinbutton', { name: 'Gate fixes' }), '3');
  await user.clear(screen.getByRole('spinbutton', { name: 'Maximum iterations' }));
  await user.type(screen.getByRole('spinbutton', { name: 'Maximum iterations' }), '75');
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe('TemplateGallery', () => {
  it('checks typed QA settings and allows a draft while unavailable isolation keeps runs blocked', async () => {
    const entry = qaTemplateEntry();
    const adversaryModel: ModelCatalogEntry = {
      ...model,
      model: 'test-adversary',
      displayName: 'Test adversary',
    };
    const onCheckPrerequisites = vi.fn((_id: string, _settings: TemplateSettings) =>
      Promise.resolve(entry.prerequisites),
    );
    const onInstantiate = vi.fn((_id: string, settings: TemplateSettings) =>
      Promise.resolve(qaResponse(entry, QaTemplateSettingsSchema.parse(settings))),
    );
    const onCreated = vi.fn();
    const user = await openQaTemplate(
      entry,
      [model, adversaryModel],
      readyCodex,
      onCheckPrerequisites,
      onInstantiate,
      onCreated,
    );

    expect(screen.getByText(/every QA run remains blocked/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Support credential key name')).toHaveValue('supportReadKey');
    expect(screen.getByLabelText('Support credential key name')).toHaveAttribute('readonly');
    expect(screen.getAllByLabelText('Model')[0]).toHaveValue('test-codex');
    expect(screen.getAllByLabelText('Model')[1]).toHaveValue('test-adversary');
    expect(screen.queryByDisplayValue(/secret-value|token-value/i)).not.toBeInTheDocument();

    await fillQaRepository(user);
    await user.selectOptions(screen.getByLabelText('Depth'), 'full-regression');
    await user.type(screen.getByLabelText('Full-regression issue label'), 'full-regression');
    await user.clear(screen.getByLabelText('Implementation trigger label'));
    await user.type(screen.getByLabelText('Implementation trigger label'), 'qa-ready');
    await user.clear(screen.getByLabelText('Dedicated proof branch'));
    await user.type(screen.getByLabelText('Dedicated proof branch'), 'qa/proof-run');
    await user.clear(screen.getByLabelText('Program'));
    await user.type(screen.getByLabelText('Program'), 'node');
    await user.clear(screen.getByLabelText('Arguments, one per line'));
    await user.type(screen.getByLabelText('Arguments, one per line'), '--test');
    await user.clear(screen.getByLabelText('Timeout in seconds'));
    await user.type(screen.getByLabelText('Timeout in seconds'), '90');
    await user.clear(screen.getByLabelText('Unsound-evidence reruns'));
    await user.type(screen.getByLabelText('Unsound-evidence reruns'), '0');
    await user.clear(screen.getByLabelText('Rework requests'));
    await user.type(screen.getByLabelText('Rework requests'), '1');
    await user.clear(screen.getByLabelText('Issue reopenings'));
    await user.type(screen.getByLabelText('Issue reopenings'), '0');
    await user.clear(screen.getByLabelText('Proof push retries'));
    await user.type(screen.getByLabelText('Proof push retries'), '2');

    await user.click(screen.getByRole('button', { name: 'Check requirements' }));
    expect(await screen.findByText('Checked for these settings.')).toBeInTheDocument();
    expect(screen.getAllByText('unavailable')).toHaveLength(2);
    expect(screen.getAllByText('Runs not ready')).toHaveLength(2);
    expect(onCheckPrerequisites).toHaveBeenCalledWith(
      'qa',
      expect.objectContaining({
        kind: 'qa',
        repository: {
          path: 'C:/repos/qa-project',
          owner: 'ExampleOrg',
          name: 'qa-project',
          baseBranch: 'main',
        },
        supportReadKey: 'supportReadKey',
        roles: {
          qa: { harness: 'codex', model: 'test-codex', effort: 'low' },
          adversary: { harness: 'codex', model: 'test-adversary', effort: 'low' },
        },
        depth: 'full-regression',
        fullRegressionLabel: 'full-regression',
        triggerLabel: 'qa-ready',
        proofBranch: 'qa/proof-run',
        gate: { program: 'node', args: ['--test'], timeoutSeconds: 90 },
        limits: { unsoundReruns: 0, reworkRequests: 1, reopenings: 0, proofPushRetries: 2 },
      }),
    );
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(onInstantiate).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(expect.any(String));
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
  });

  it('removes an optional full-regression label when cleared and preserves explicit role selection', async () => {
    const entry = qaTemplateEntry();
    const claudeModel: ModelCatalogEntry = {
      ...model,
      harness: 'claude',
      model: 'catalog-claude-qa',
      displayName: 'Catalog Claude QA',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
    };
    const preflight = [
      ...readyCodex,
      {
        harness: 'claude',
        ok: true,
        authenticated: true,
        problems: [],
        models: [
          {
            model: 'catalog-claude-qa',
            admission: 'supported' as const,
            efforts: ['high' as const],
            reasonCode: null,
            billingStatus: 'account-dependent' as const,
          },
        ],
      },
    ];
    const onCheckPrerequisites = vi.fn((_id: string, _settings: TemplateSettings) =>
      Promise.resolve(entry.prerequisites),
    );
    const user = await openQaTemplate(entry, [model, claudeModel], preflight, onCheckPrerequisites);
    const harnesses = screen.getAllByLabelText('Harness');
    await user.selectOptions(harnesses[1]!, 'claude');
    const models = screen.getAllByLabelText('Model');
    await user.selectOptions(models[1]!, 'catalog-claude-qa');
    const efforts = screen.getAllByLabelText('Effort');
    expect(efforts[1]).toHaveValue('low');
    expect(screen.getByRole('option', { name: 'high' })).toBeInTheDocument();
    await user.selectOptions(efforts[1]!, 'high');
    await user.type(screen.getByLabelText('Full-regression issue label'), 'regression');
    await user.clear(screen.getByLabelText('Full-regression issue label'));
    await fillQaRepository(user);

    await user.click(screen.getByRole('button', { name: 'Check requirements' }));
    expect(await screen.findByText('Checked for these settings.')).toBeInTheDocument();
    const checked = onCheckPrerequisites.mock.calls[0]?.[1];
    expect(checked?.kind).toBe('qa');
    if (checked?.kind !== 'qa') throw new Error('QA settings were not sent');
    expect(Object.hasOwn(checked, 'fullRegressionLabel')).toBe(false);
    expect(checked.roles.adversary).toEqual({
      harness: 'claude',
      model: 'catalog-claude-qa',
      effort: 'high',
    });
    expect(checked.roles.qa.model).toBe('test-codex');
    expect(checked.depth).toBe('standard');
  });

  it('keeps QA counts within authored bounds and offers no isolation override', async () => {
    const entry = qaTemplateEntry();
    const onCheckPrerequisites = vi.fn();
    const user = await openQaTemplate(entry, [model], readyCodex, onCheckPrerequisites);
    const reruns = screen.getByRole('spinbutton', { name: 'Unsound-evidence reruns' });
    expect(reruns).toHaveAttribute('min', '0');
    expect(reruns).toHaveAttribute('max', '1');
    await user.clear(reruns);
    await user.type(reruns, '2');

    expect(reruns).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Check requirements' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: /isolation/i })).not.toBeInTheDocument();
    expect(onCheckPrerequisites).not.toHaveBeenCalled();
  });

  it('authors typed review settings, rechecks changed settings, then creates the draft', async () => {
    const user = userEvent.setup();
    const entry = reviewTemplateEntry();
    const reviewerModel: ModelCatalogEntry = {
      ...model,
      model: 'catalog-reviewer',
      displayName: 'Catalog reviewer',
      efforts: ['low', 'high'],
      defaultEffort: 'high',
    };
    const fixerModel: ModelCatalogEntry = {
      ...model,
      model: 'catalog-fixer',
      displayName: 'Catalog fixer',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
    };
    const onCheckPrerequisites = vi.fn((_id: string, _settings: TemplateSettings) =>
      Promise.resolve(entry.prerequisites),
    );
    const createdParentId = id('review-parent');
    const onInstantiate = vi.fn((_id: string, settings: TemplateSettings) =>
      Promise.resolve(
        reviewResponse(entry, ReviewTemplateSettingsSchema.parse(settings), createdParentId),
      ),
    );
    const onCreated = vi.fn();

    render(
      <MemoryRouter initialEntries={['/loops']}>
        <TemplateGallery
          templates={[entry]}
          models={[reviewerModel, fixerModel]}
          preflight={readyCodex}
          onCheckPrerequisites={onCheckPrerequisites}
          onInstantiate={onInstantiate}
          onCreated={onCreated}
        />
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'New from template' }));
    await user.click(screen.getByRole('button', { name: 'Use GitHub PR review' }));

    expect(screen.getByLabelText('Checkout path')).toHaveValue('');
    expect(screen.getByLabelText('Support credential key name')).toHaveValue('supportReadKey');
    expect(screen.getByLabelText('Support credential key name')).toHaveAttribute('readonly');
    expect(screen.getByRole('group', { name: 'Reviewer model' })).toHaveTextContent(
      'Catalog reviewer',
    );
    expect(screen.getByRole('group', { name: 'Fixer model' })).toHaveTextContent('Catalog fixer');
    expect(
      screen.getByRole('checkbox', { name: 'Require a human choice before every merge' }),
    ).not.toBeChecked();
    expect(screen.getByLabelText('Needs-human label')).toHaveValue('needs-human');
    expect(screen.getByLabelText('Merge method')).toHaveValue('squash');
    expect(screen.getByLabelText('Required checks')).toHaveValue('protection');
    expect(screen.getByRole('spinbutton', { name: 'Automatic review cycles' })).toHaveValue(3);

    await user.type(screen.getByRole('textbox', { name: 'Checkout path' }), 'C:/repos/graphgoblin');
    await user.type(screen.getByRole('textbox', { name: 'Repository owner' }), 'GraphGoblinOrg');
    await user.type(screen.getByRole('textbox', { name: 'Repository name' }), 'GraphGoblin');
    await user.type(screen.getByRole('textbox', { name: 'Base branch' }), 'main');
    await user.click(
      screen.getByRole('checkbox', { name: 'Require a human choice before every merge' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Labels that require human review' }),
      'needs-human{Enter}security-review',
    );
    await user.clear(screen.getByRole('textbox', { name: 'Needs-human label' }));
    await user.type(screen.getByRole('textbox', { name: 'Needs-human label' }), 'reviewer-needed');
    await user.type(
      screen.getByRole('textbox', { name: 'Additional trusted authors' }),
      'trusted-bot',
    );
    await user.selectOptions(screen.getByLabelText('Required checks'), 'explicit');
    expect(
      screen.getByText(/An empty list explicitly requires no named CI checks/i),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Required check names, one per line' }),
      'lint{Enter}unit',
    );
    await user.selectOptions(screen.getByLabelText('Merge method'), 'rebase');
    await user.clear(screen.getByRole('spinbutton', { name: 'Automatic review cycles' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Automatic review cycles' }), '2');
    await user.clear(screen.getByRole('spinbutton', { name: 'Additional human-requested cycles' }));
    await user.type(
      screen.getByRole('spinbutton', { name: 'Additional human-requested cycles' }),
      '1',
    );

    await user.click(screen.getByRole('button', { name: 'Check requirements' }));
    expect(await screen.findByText('Checked for these settings.')).toBeInTheDocument();
    expect(onCheckPrerequisites).toHaveBeenNthCalledWith(
      1,
      'review',
      expect.objectContaining({
        kind: 'review',
        repository: {
          path: 'C:/repos/graphgoblin',
          owner: 'GraphGoblinOrg',
          name: 'GraphGoblin',
          baseBranch: 'main',
        },
        supportReadKey: 'supportReadKey',
        roles: {
          reviewer: { harness: 'codex', model: 'catalog-reviewer', effort: 'high' },
          fixer: { harness: 'codex', model: 'catalog-fixer', effort: 'low' },
        },
        requireHumanBeforeMerge: true,
        humanReviewLabels: ['needs-human', 'security-review'],
        needsHumanLabel: 'reviewer-needed',
        trustedAuthors: ['trusted-bot'],
        requiredChecks: { source: 'explicit', names: ['lint', 'unit'] },
        mergeMethod: 'rebase',
        limits: expect.objectContaining({ automaticCycles: 2, extraCycles: 1 }),
      }),
    );

    const requiredCheckNames = screen.getByRole('textbox', {
      name: 'Required check names, one per line',
    });
    await user.clear(requiredCheckNames);
    expect(
      screen.getByText(/An empty list explicitly requires no named CI checks/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Check the current settings before creating a draft.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Check requirements' }));
    expect(await screen.findByText('Checked for these settings.')).toBeInTheDocument();
    expect(onCheckPrerequisites).toHaveBeenNthCalledWith(
      2,
      'review',
      expect.objectContaining({ requiredChecks: { source: 'explicit', names: [] } }),
    );
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(onInstantiate).toHaveBeenCalledTimes(1);
    expect(onInstantiate).toHaveBeenCalledWith(
      'review',
      expect.objectContaining({ requiredChecks: { source: 'explicit', names: [] } }),
    );
    expect(onCreated).toHaveBeenCalledWith(createdParentId);
    expect(screen.getByTestId('location')).toHaveTextContent('/loops');
  });

  it('keeps creation blocked when either review role is not ready in current preflight', async () => {
    const user = userEvent.setup();
    const entry = reviewTemplateEntry();
    render(
      <MemoryRouter initialEntries={['/loops']}>
        <TemplateGallery
          templates={[entry]}
          models={[model]}
          preflight={[
            { harness: 'codex', ok: false, authenticated: false, problems: ['login required'] },
          ]}
          onCheckPrerequisites={() => Promise.resolve(entry.prerequisites)}
          onInstantiate={() => Promise.reject(new Error('must not instantiate'))}
          onCreated={() => undefined}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'New from template' }));
    await user.click(screen.getByRole('button', { name: 'Use GitHub PR review' }));

    expect(screen.getAllByText(/This harness is not ready yet/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Check requirements' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
  });

  it('authors implementation settings, rechecks requirements, and creates with the literal values', async () => {
    const user = userEvent.setup();
    const entry = implementationTemplateEntry();
    const implementerModel: ModelCatalogEntry = {
      ...model,
      model: 'catalog-implementer',
      displayName: 'Catalog implementer',
      efforts: ['low', 'high'],
      defaultEffort: 'high',
    };
    const onCheckPrerequisites = vi.fn((_id: string, _settings: TemplateSettings) =>
      Promise.resolve(entry.prerequisites),
    );
    const onInstantiate = vi.fn((_id: string, settings: TemplateSettings) =>
      Promise.resolve(
        implementationResponse(entry, ImplementationTemplateSettingsSchema.parse(settings)),
      ),
    );

    await openImplementationTemplate(
      user,
      entry,
      [implementerModel],
      readyCodex,
      onCheckPrerequisites,
      onInstantiate,
    );

    expect(screen.getByLabelText('Checkout path')).toHaveValue('');
    expect(screen.getByLabelText('Model')).toHaveValue('catalog-implementer');
    expect(screen.getByLabelText('Effort')).toHaveValue('high');
    expect(screen.getByLabelText('Support credential key name')).toHaveValue('supportReadKey');
    expect(screen.getByLabelText('Support credential key name')).toHaveAttribute('readonly');
    expect(screen.queryByDisplayValue(/secret-value|token-value/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check requirements' })).toBeDisabled();

    await fillImplementationSettings(user);
    expect(
      screen.getByText(/native program or the packaged Node pnpm launcher/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check requirements' })).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: 'Program' }));
    await user.type(screen.getByRole('textbox', { name: 'Program' }), 'pnpm');
    expect(
      screen.queryByText(/native program or the packaged Node pnpm launcher/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check requirements' }));
    expect(await screen.findByText('Checked for these settings.')).toBeInTheDocument();
    expect(onCheckPrerequisites).toHaveBeenCalledWith(
      entry.manifest.id,
      expect.objectContaining({
        kind: 'implementation',
        repository: {
          path: 'C:/repos/graphgoblin',
          owner: 'GraphGoblinOrg',
          name: 'GraphGoblin',
          baseBranch: 'main',
        },
        supportReadKey: 'supportReadKey',
        gate: { program: 'pnpm', args: ['check', 'test:coverage'], timeoutSeconds: 120 },
        roles: {
          implementer: {
            harness: 'codex',
            model: 'catalog-implementer',
            effort: 'high',
          },
        },
        labels: {
          trigger: 'ready-to-build',
          inProgress: 'building',
          prOpen: 'review-open',
          blocked: 'needs-help',
        },
        limits: { maxTasks: 12, gateFixes: 3, maxIterations: 75 },
      }),
    );
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(onInstantiate).toHaveBeenCalledTimes(1);
    expect(onInstantiate).toHaveBeenCalledWith(
      entry.manifest.id,
      expect.objectContaining({
        repository: expect.objectContaining({ owner: 'GraphGoblinOrg', name: 'GraphGoblin' }),
        supportReadKey: 'supportReadKey',
        gate: expect.objectContaining({ args: ['check', 'test:coverage'] }),
      }),
    );
  });

  it('leaves the role model empty with remediation when no enabled Codex model is available', async () => {
    const user = userEvent.setup();
    const entry = implementationTemplateEntry();
    await openImplementationTemplate(user, entry, [], readyCodex);

    expect(screen.getByLabelText('Model')).toHaveValue('');
    expect(
      screen.getByText(/No current model is selected.*supported Codex model in Settings/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check requirements' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
  });

  it('filters Claude role choices and efforts through current preflight capabilities', async () => {
    const user = userEvent.setup();
    const entry = implementationTemplateEntry();
    const claudeModel: ModelCatalogEntry = {
      ...model,
      harness: 'claude',
      model: 'catalog-claude',
      displayName: 'Catalog Claude',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
    };
    const preflight = [
      ...readyCodex,
      {
        harness: 'claude',
        ok: true,
        authenticated: true,
        problems: [],
        models: [
          {
            model: 'catalog-claude',
            admission: 'supported' as const,
            efforts: ['high' as const],
          },
        ],
      },
    ];
    await openImplementationTemplate(user, entry, [model, claudeModel], preflight);

    await user.selectOptions(screen.getByLabelText('Harness'), 'claude');
    await user.selectOptions(screen.getByLabelText('Model'), 'catalog-claude');
    expect(screen.getByRole('option', { name: 'high' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'low — unavailable' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Effort'), 'high');
    expect(screen.getByLabelText('Effort')).toHaveValue('high');
  });

  it('keeps a committed draft available when opening the editor fails', async () => {
    const user = userEvent.setup();
    const entry = starterTemplateEntry();
    const settings = entry.defaultSettings;
    if (!settings) throw new Error('starter fixture must include typed defaults');
    const parentLoopId = id('created-parent');
    const response = TemplateInstantiateResponseSchema.parse({
      instance: {
        id: id('template-instance'),
        ownerId: 'local',
        templateId: entry.manifest.id,
        templateVersion: entry.manifest.version,
        createdAt: TS,
        parentLoopId,
        loops: [
          {
            key: entry.manifest.parentKey,
            loopId: parentLoopId,
            versionId: id('draft-version'),
            version: 1,
            status: 'draft',
          },
        ],
        settings,
      },
      prerequisites: entry.prerequisites,
    });
    const onInstantiate = vi.fn(() => Promise.resolve(response));
    const onCreated = vi.fn(() => Promise.reject(new Error('Editor navigation failed.')));

    render(
      <MemoryRouter initialEntries={['/loops']}>
        <TemplateGallery
          templates={[entry]}
          models={[model]}
          preflight={[{ harness: 'codex', ok: true, authenticated: true, problems: [] }]}
          onCheckPrerequisites={() => Promise.resolve(entry.prerequisites)}
          onInstantiate={onInstantiate}
          onCreated={onCreated}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'New from template' }));
    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Draft created, but the editor could not be opened',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Editor navigation failed.');
    expect(screen.getByRole('link', { name: 'Open the created draft' })).toHaveAttribute(
      'href',
      `/loops/${parentLoopId}/edit`,
    );
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    expect(onInstantiate).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(parentLoopId);

    await user.click(screen.getByRole('link', { name: 'Open the created draft' }));
    expect(screen.getByTestId('location')).toHaveTextContent(`/loops/${parentLoopId}/edit`);
  });
});
