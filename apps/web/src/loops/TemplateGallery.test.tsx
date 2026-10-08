import {
  ImplementationTemplateSettingsSchema,
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
  starterTemplateEntry,
  TS,
} from '../__fixtures__/fake-api.js';
import { TemplateGallery } from './TemplateGallery.js';

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
