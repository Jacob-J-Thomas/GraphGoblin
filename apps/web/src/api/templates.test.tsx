import type { TemplateInstance } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTemplate, useTemplateInstance, useTemplates } from './queries.js';
import { FakeApi, id, starterTemplateEntry } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';

const INSTANCE_ID = id('template-query-instance');

function TemplateQueries({ instanceId }: { instanceId: string }) {
  const list = useTemplates();
  const detail = useTemplate('quick-start');
  const instance = useTemplateInstance(instanceId);
  const disabledDetail = useTemplate('');
  const disabledInstance = useTemplateInstance('');
  return (
    <div>
      <output data-testid="template-list">{list.data?.length ?? 'loading'}</output>
      <output data-testid="template-detail">{detail.data?.manifest.title ?? 'loading'}</output>
      <output data-testid="template-instance">{instance.data?.templateId ?? 'loading'}</output>
      <output data-testid="disabled-queries">
        {`${disabledDetail.fetchStatus}/${disabledInstance.fetchStatus}`}
      </output>
    </div>
  );
}

describe('template query hooks', () => {
  it('loads the catalog, detail and owner-scoped instance through the API client', async () => {
    const api = new FakeApi();
    const entry = starterTemplateEntry();
    api.templates = [entry];
    const parent = api.addLoop(minimalLoop());
    const draft = api.loops.get(parent.id)!.draft!;
    if (!entry.defaultSettings) throw new Error('fixture has no typed defaults');
    const instance: TemplateInstance = {
      id: INSTANCE_ID,
      ownerId: 'local',
      templateId: entry.manifest.id,
      templateVersion: entry.manifest.version,
      createdAt: draft.createdAt,
      parentLoopId: parent.id,
      loops: [
        {
          key: entry.manifest.parentKey,
          loopId: parent.id,
          versionId: draft.id,
          version: draft.version,
          status: 'draft',
        },
      ],
      settings: entry.defaultSettings,
    };
    api.templateInstances.set(INSTANCE_ID, instance);

    renderWith(<TemplateQueries instanceId={INSTANCE_ID} />, '/', api);

    await waitFor(() => expect(screen.getByTestId('template-list')).toHaveTextContent('1'));
    await waitFor(() =>
      expect(screen.getByTestId('template-detail')).toHaveTextContent('Quick start'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('template-instance')).toHaveTextContent('quick-start'),
    );
    expect(screen.getByTestId('disabled-queries')).toHaveTextContent('idle/idle');
    expect(api.callsTo('GET', '/templates')).toHaveLength(1);
    expect(api.callsTo('GET', '/templates/quick-start')).toHaveLength(1);
    expect(api.callsTo('GET', `/template-instances/${INSTANCE_ID}`)).toHaveLength(1);
  });
});
