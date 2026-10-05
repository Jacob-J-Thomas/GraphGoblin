import { minimalLoop } from '@graphgoblin/contracts/testing';
import { ReactFlowProvider } from '@xyflow/react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIND_INFO, KIND_MIME, NODE_KINDS } from './model.js';
import { PALETTE_PANEL_WIDE, Palette, palettePanelDefault } from './Palette.js';
import { useEditorStore } from './store.js';

describe('Palette rail', () => {
  beforeEach(() => {
    useEditorStore.getState().load('test-loop', minimalLoop());
  });

  afterEach(() => {
    cleanup();
    useEditorStore.getState().reset();
  });

  it('defaults to expanded at the wide threshold and collapsed below it', () => {
    const width = vi.spyOn(window, 'innerWidth', 'get');
    width.mockReturnValue(PALETTE_PANEL_WIDE);
    expect(palettePanelDefault()).toBe(true);
    width.mockReturnValue(PALETTE_PANEL_WIDE - 1);
    expect(palettePanelDefault()).toBe(false);
    width.mockRestore();
  });

  it('keeps all nine add buttons, names, tooltips, click and Enter actions while collapsed', async () => {
    const user = userEvent.setup();
    render(
      <ReactFlowProvider>
        <Palette expanded={false} onExpandedChange={vi.fn()} />
      </ReactFlowProvider>,
    );

    const panel = screen.getByRole('complementary', { name: 'Palette' });
    expect(panel).toHaveAttribute('id', 'palette');
    expect(within(panel).getAllByRole('button')).toHaveLength(NODE_KINDS.length + 1);
    for (const kind of NODE_KINDS) {
      const button = screen.getByRole('button', {
        name: `Add ${KIND_INFO[kind].label} node`,
      });
      expect(button).toHaveAttribute('title', KIND_INFO[kind].description);
      expect(button).toHaveAttribute('draggable', 'true');
      expect(button.className).toContain('size-11');
    }

    const beforeClick = useEditorStore.getState().definition!.nodes.length;
    await user.click(screen.getByRole('button', { name: 'Add Wait node' }));
    expect(useEditorStore.getState().definition!.nodes).toHaveLength(beforeClick + 1);
    expect(useEditorStore.getState().definition!.nodes.at(-1)?.kind).toBe('wait');

    const script = screen.getByRole('button', { name: 'Add Script node' });
    script.focus();
    await user.keyboard('{Enter}');
    expect(useEditorStore.getState().definition!.nodes.at(-1)?.kind).toBe('script');
  });

  it('keeps the same drag source from the rail', () => {
    render(
      <ReactFlowProvider>
        <Palette expanded={false} onExpandedChange={vi.fn()} />
      </ReactFlowProvider>,
    );
    const setData = vi.fn();
    const button = screen.getByRole('button', { name: 'Add Exit node' });
    fireEvent.dragStart(button, {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith(KIND_MIME, 'exit');
  });
});
