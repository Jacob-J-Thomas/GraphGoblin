import {
  LoopDefinitionSchema,
  TemplateDraftResponseSchema,
  type TemplateCatalogEntry,
  type TemplateDraftResponse,
} from '@graphgoblin/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  id,
  implementationTemplateEntry,
  starterTemplateEntry,
  TS,
} from '../__fixtures__/fake-api.js';
import { TemplateGallery } from './TemplateGallery.js';

function editableDraft(entry: TemplateCatalogEntry): TemplateDraftResponse {
  const loopId = id(`${entry.manifest.id}-draft`);
  const draftId = id(`${entry.manifest.id}-version`);
  const definition = LoopDefinitionSchema.parse({
    ...minimalLoop(),
    name: entry.manifest.title,
  });
  return TemplateDraftResponseSchema.parse({
    loop: {
      id: loopId,
      ownerId: 'local',
      name: entry.manifest.title,
      draftVersionId: draftId,
      createdAt: TS,
      updatedAt: TS,
    },
    draft: {
      id: draftId,
      loopId,
      version: 1,
      status: 'draft',
      definition,
      createdAt: TS,
    },
    issues: [],
  });
}

describe('TemplateGallery', () => {
  it('creates directly without settings or readiness and guards repeated cross-card activation', async () => {
    const user = userEvent.setup();
    const entry = starterTemplateEntry();
    const implementation = implementationTemplateEntry();
    entry.defaultSettings = null;
    entry.prerequisites.canInstantiate = false;
    entry.prerequisites.canRun = false;
    implementation.defaultSettings = null;
    implementation.prerequisites.canInstantiate = false;
    implementation.prerequisites.canRun = false;
    implementation.prerequisites.checks = [
      {
        id: 'settings',
        label: 'Settings',
        status: 'missing',
        blocking: 'authoring',
        message: 'Complete valid settings for this template.',
        remediation: 'Choose all required roles and correct the settings fields.',
      },
    ];
    let finishCreate!: (response: TemplateDraftResponse) => void;
    let finishHandoff!: () => void;
    const pendingCreate = new Promise<TemplateDraftResponse>((resolve) => {
      finishCreate = resolve;
    });
    const pendingHandoff = new Promise<void>((resolve) => {
      finishHandoff = resolve;
    });
    const onCreateDraft = vi.fn(() => pendingCreate);
    const onCreated = vi.fn(() => pendingHandoff);

    render(
      <MemoryRouter initialEntries={['/loops']}>
        <TemplateGallery
          templates={[entry, implementation]}
          onCreateDraft={onCreateDraft}
          onCreated={onCreated}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'New from template' }));
    const create = screen.getByRole('button', { name: 'Use Quick start' });
    const otherCreate = screen.getByRole('button', { name: 'Use Implementation workflow' });
    expect(create).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /^Use / })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Configure/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/requirements|setup needed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(entry.manifest.description)).toBeVisible();
    expect(screen.getByText(implementation.manifest.description)).toBeVisible();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(create);
      fireEvent.click(create);
      fireEvent.click(otherCreate);
    });
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(onCreateDraft).toHaveBeenCalledWith('quick-start');
    expect(create).toHaveAttribute('aria-disabled', 'true');
    expect(create).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Creating draft');
    expect(create).not.toBeDisabled();
    expect(otherCreate).toHaveAttribute('aria-disabled', 'true');

    const response = editableDraft(entry);
    await act(async () => {
      finishCreate(response);
      await pendingCreate;
    });
    expect(await screen.findByRole('button', { name: 'Opening draft…' })).toBeInTheDocument();
    fireEvent.click(otherCreate);
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(response.loop.id);

    await act(async () => {
      finishHandoff();
      await pendingHandoff;
    });
    expect(screen.getByRole('button', { name: 'Use Quick start' })).toBeEnabled();
  });

  it('reports create failures without automatically retrying the mutation', async () => {
    const user = userEvent.setup();
    const entry = starterTemplateEntry();
    const onCreateDraft = vi.fn(() => Promise.reject(new Error('Draft service unavailable.')));
    const onCreateFailed = vi.fn();

    render(
      <MemoryRouter initialEntries={['/loops']}>
        <TemplateGallery
          templates={[entry]}
          onCreateDraft={onCreateDraft}
          onCreated={() => undefined}
          onCreateFailed={onCreateFailed}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'New from template' }));
    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not create the Quick start draft',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Draft service unavailable.');
    expect(screen.getByRole('alert')).toHaveTextContent('check the loop list');
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(onCreateFailed).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));
    expect(onCreateDraft).toHaveBeenCalledTimes(2);
  });

  it('retains the created id and retries editor opening without creating another draft', async () => {
    const user = userEvent.setup();
    const entry = starterTemplateEntry();
    const response = editableDraft(entry);
    const onCreateDraft = vi.fn(() => Promise.resolve(response));
    const onCreated = vi
      .fn<(_: string) => void | Promise<void>>()
      .mockRejectedValueOnce(new Error('Editor navigation failed.'))
      .mockResolvedValueOnce(undefined);

    render(
      <MemoryRouter initialEntries={['/loops']}>
        <TemplateGallery templates={[entry]} onCreateDraft={onCreateDraft} onCreated={onCreated} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'New from template' }));
    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Quick start draft created, but the editor could not be opened',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Editor navigation failed.');
    expect(screen.getByRole('link', { name: 'Open the created draft' })).toHaveAttribute(
      'href',
      `/loops/${response.loop.id}/edit`,
    );
    expect(screen.getByRole('button', { name: 'Use Quick start' })).toBeEnabled();
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));
    expect(onCreated).toHaveBeenLastCalledWith(response.loop.id);
    expect(onCreateDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Use Quick start' })).toBeEnabled();
  });

  it.each(['success', 'failure'] as const)(
    'keeps keyboard focus after creation %s',
    async (outcome) => {
      const user = userEvent.setup();
      const entry = starterTemplateEntry();
      let finish!: (result: TemplateDraftResponse) => void;
      let fail!: (error: Error) => void;
      const pending = new Promise<TemplateDraftResponse>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      render(
        <MemoryRouter>
          <TemplateGallery
            templates={[entry]}
            onCreateDraft={() => pending}
            onCreated={() => undefined}
            onCreateFailed={() => Promise.reject(new Error('Refresh failed.'))}
          />
        </MemoryRouter>,
      );
      const opener = screen.getByRole('button', { name: 'New from template' });
      opener.focus();
      await user.keyboard('{Enter}');
      await user.tab();
      const create = screen.getByRole('button', { name: 'Use Quick start' });
      expect(create).toHaveFocus();
      await user.keyboard('{Enter}{Enter}');
      expect(create).toHaveFocus();
      expect(create).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        if (outcome === 'success') finish(editableDraft(entry));
        else fail(new Error('Draft unavailable.'));
        await pending.catch(() => undefined);
      });
      expect(create).toHaveFocus();
      expect(create).not.toHaveAttribute('aria-busy');
      if (outcome === 'failure')
        expect(screen.getByRole('alert')).toHaveTextContent('Draft unavailable.');
      await user.click(screen.getByRole('button', { name: 'Hide templates' }));
      expect(screen.queryByRole('heading', { name: 'Choose a template' })).not.toBeInTheDocument();
    },
  );

  it('preserves a deliberate focus move while creation is pending', async () => {
    const user = userEvent.setup();
    const entry = starterTemplateEntry();
    let finish!: (result: TemplateDraftResponse) => void;
    const pending = new Promise<TemplateDraftResponse>((resolve) => {
      finish = resolve;
    });
    render(
      <MemoryRouter>
        <TemplateGallery
          templates={[entry]}
          onCreateDraft={() => pending}
          onCreated={() => undefined}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'New from template' }));
    await user.click(screen.getByRole('button', { name: 'Use Quick start' }));
    const opener = screen.getByRole('button', { name: 'Hide templates' });
    opener.focus();
    await act(async () => {
      finish(editableDraft(entry));
      await pending;
    });
    expect(opener).toHaveFocus();
  });
});
