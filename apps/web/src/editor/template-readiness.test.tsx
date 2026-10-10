import {
  QaTemplateSettingsSchema,
  StarterTemplateSettingsSchema,
  TemplateInstanceSchema,
} from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, id, problem, qaTemplateEntry, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

function qaInstance(api: FakeApi) {
  const parent = api.addLoop({ ...minimalLoop(), name: 'QA parent' });
  const child = api.addLoop({ ...minimalLoop(), name: 'Adversary child' }, { published: true });
  const selection = { harness: 'codex', model: 'test-codex', effort: 'low' };
  const instance = TemplateInstanceSchema.parse({
    id: id('qa-instance'),
    ownerId: 'local',
    templateId: 'qa',
    templateVersion: '1.0.0',
    createdAt: TS,
    parentLoopId: parent.id,
    loops: [
      {
        key: 'parent',
        loopId: parent.id,
        versionId: api.loops.get(parent.id)!.draft!.id,
        version: 2,
        status: 'draft',
      },
      {
        key: 'adversary',
        loopId: child.id,
        versionId: api.loops.get(child.id)!.current!.id,
        version: 1,
        status: 'published',
      },
    ],
    settings: QaTemplateSettingsSchema.parse({
      kind: 'qa',
      repository: {
        path: 'C:/repos/project',
        owner: 'ExampleOrg',
        name: 'project',
        baseBranch: 'main',
      },
      supportReadKey: 'supportReadKey',
      roles: { qa: selection, adversary: selection },
    }),
  });
  api.templateInstances.set(instance.id, instance);
  return { parent, child, instance };
}

describe('saved QA parent runtime readiness', () => {
  it('opens a gallery QA copy without an instance binding or configured-parent warning', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    qaInstance(api);
    api.templates = [qaTemplateEntry()];
    renderApp('/loops', api);
    await user.click(await screen.findByRole('button', { name: 'New from template' }));
    await user.click(screen.getByRole('button', { name: 'Use Post-merge QA' }));
    expect(await screen.findByText('Ready to publish')).toBeVisible();
    expect(api.callsTo('POST', '/templates/qa/draft')).toHaveLength(1);
    expect(api.callsTo('GET', /template-instances/)).toHaveLength(0);
    expect(screen.queryByText('QA execution is blocked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });

  it('shows the persisted parent warning after reopening, while preserving Publish', async () => {
    const api = new FakeApi();
    const { parent, instance } = qaInstance(api);
    const first = renderApp('/loops/' + parent.id + '/edit', api);
    expect(await screen.findByText('Graph ready to publish; QA execution blocked')).toBeVisible();
    expect(screen.getByText(/Enforced evidence-only isolation is unavailable/)).toBeVisible();
    expect(screen.getByText(/permanently consume merge and linked-issue attempts/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(api.callsTo('GET', '/template-instances/' + instance.id)).toHaveLength(1);
    first.unmount();
    renderApp('/loops/' + parent.id + '/edit', api);
    expect(await screen.findByText('QA execution is blocked')).toBeVisible();
    expect(api.callsTo('POST', /prerequisites|runs|publish/)).toHaveLength(0);
  });

  it('does not warn on the bound QA child', async () => {
    const api = new FakeApi();
    const { child, instance } = qaInstance(api);
    renderApp('/loops/' + child.id + '/edit', api);
    expect(await screen.findByText('Ready to publish')).toBeVisible();
    await waitFor(() =>
      expect(api.callsTo('GET', '/template-instances/' + instance.id)).toHaveLength(1),
    );
    expect(screen.queryByText('QA execution is blocked')).toBeNull();
  });

  it('does not fetch an instance or infer QA readiness for an unbound loop', async () => {
    const api = new FakeApi();
    const loop = api.addLoop({ ...minimalLoop(), name: 'Post-merge QA' });
    renderApp('/loops/' + loop.id + '/edit', api);
    expect(await screen.findByText('Ready to publish')).toBeVisible();
    expect(api.callsTo('GET', /template-instances/)).toHaveLength(0);
    expect(screen.queryByText('QA execution is blocked')).toBeNull();
  });

  it.each(['unrelated-parent', 'foreign-owner', 'unrelated-id', 'private', 'non-QA'] as const)(
    'does not apply QA readiness to a %s instance response',
    async (kind) => {
      const api = new FakeApi();
      const { parent, instance } = qaInstance(api);
      api.override('GET /template-instances/:id', () =>
        kind === 'private'
          ? problem(404, 'TEMPLATE_INSTANCE_NOT_FOUND')
          : Response.json({
              ...instance,
              ...(kind === 'unrelated-parent' ? { parentLoopId: id('unrelated') } : {}),
              ...(kind === 'foreign-owner' ? { ownerId: 'other' } : {}),
              ...(kind === 'unrelated-id' ? { id: id('unrelated') } : {}),
              ...(kind === 'non-QA'
                ? {
                    settings: StarterTemplateSettingsSchema.parse({
                      kind: 'starter',
                      roles: {
                        assistant: { harness: 'codex', model: 'test-codex', effort: 'low' },
                      },
                    }),
                  }
                : {}),
            }),
      );
      renderApp('/loops/' + parent.id + '/edit', api);
      expect(await screen.findByText('Ready to publish')).toBeVisible();
      await waitFor(() =>
        expect(api.callsTo('GET', '/template-instances/' + instance.id).length).toBeGreaterThan(0),
      );
      expect(screen.queryByText('QA execution is blocked')).toBeNull();
      expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    },
  );
});
