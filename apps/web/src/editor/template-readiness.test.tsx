import { QaTemplateSettingsSchema, TemplateInstanceSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, id, qaTemplateEntry, TS } from '../__fixtures__/fake-api.js';
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

describe('editor without template instance metadata', () => {
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

  it('reopens a configured parent without fetching instance metadata, while preserving Publish', async () => {
    const api = new FakeApi();
    const { parent } = qaInstance(api);
    const first = renderApp('/loops/' + parent.id + '/edit', api);
    expect(await screen.findByText('Ready to publish')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(api.callsTo('GET', /template-instances/)).toHaveLength(0);
    first.unmount();
    renderApp('/loops/' + parent.id + '/edit', api);
    expect(await screen.findByText('Ready to publish')).toBeVisible();
    expect(screen.queryByText('QA execution is blocked')).toBeNull();
    expect(api.callsTo('GET', /template-instances/)).toHaveLength(0);
    expect(api.callsTo('POST', /prerequisites|runs|publish/)).toHaveLength(0);
  });

  it('does not warn on the bound QA child', async () => {
    const api = new FakeApi();
    const { child } = qaInstance(api);
    renderApp('/loops/' + child.id + '/edit', api);
    expect(await screen.findByText('Ready to publish')).toBeVisible();
    expect(api.callsTo('GET', /template-instances/)).toHaveLength(0);
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
});
