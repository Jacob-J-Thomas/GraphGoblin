import { TemplateInstantiateResponseSchema, type ModelCatalogEntry } from '@graphgoblin/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { id, starterTemplateEntry, TS } from '../__fixtures__/fake-api.js';
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe('TemplateGallery', () => {
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
