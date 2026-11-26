import type { SystemChatBinding } from '@graphgoblin/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusFallback } from '../lib/focus.js';
import { EditorToolbar } from './EditorToolbar.js';
import { newLoopDefinition } from './model.js';
import { useEditorStore } from './store.js';

type Props = ComponentProps<typeof EditorToolbar>;

const BASE: Props = {
  loopId: 'L1',
  name: 'loop',
  published: true,
  version: 1,
  saveState: 'saved',
  device: 'device',
  saveMessage: undefined,
  errors: 0,
  validation: <span>Ready to publish</span>,
  publishing: false,
  onPublish: () => undefined,
};

function toolbar(props: Partial<Props> = {}) {
  return (
    <MemoryRouter>
      <EditorToolbar {...BASE} {...props} />
    </MemoryRouter>
  );
}

const store = () => useEditorStore.getState();

/** The same elements in the same order: identity, not the structural equality of `toEqual`. */
function expectSameNodes(actual: readonly Element[], expected: readonly Element[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((element, index) => expect(element).toBe(expected[index]));
}

/** The toolbar's `<header>` and the leading history slot. */
const parts = () => {
  const slot = screen.getByTestId('history-actions');
  const header = slot.parentElement!;
  return { header, slot };
};

/** Every state the bar's width-changing content goes through in a real editing session. */
const TRANSITIONS: readonly [string, Partial<Props>][] = [
  ['first paint: checking', { validation: <span>Checking…</span>, saveState: 'idle' }],
  ['unsaved edit with issues', { saveState: 'pending', validation: <button>2 errors</button> }],
  ['saving', { saveState: 'saving', validation: <button>4 errors, 1 warning</button> }],
  ['saved and ready', { saveState: 'saved', validation: <span>Ready to publish</span> }],
  ['validation unavailable', { validation: <span>Validation unavailable</span> }],
  ['offline save', { saveState: 'offline', device: 'writing' }],
  ['kept in this window only', { saveState: 'offline', device: 'memory' }],
  ['name conflict', { saveState: 'name-conflict' }],
  ['held field input', { saveState: 'saved', heldInput: true }],
  ['publishing', { publishing: true }],
  ['published v12', { published: true, version: 12 }],
  ['draft only', { published: false, version: undefined }],
  ['a 120-character name', { name: 'a very long loop name '.repeat(6).slice(0, 120) }],
  [
    'a Chat system loop',
    {
      system: {
        audience: { kind: 'device', deviceId: 'dev-1' },
      } as unknown as SystemChatBinding,
    },
  ],
  ['a publish blocker', { publishBlockedReason: 'A model catalog could not be loaded.' }],
];

describe('EditorToolbar history slot', () => {
  beforeEach(() => store().load('L1', newLoopDefinition('a')));
  afterEach(() => store().reset());

  it('leads the bar: first in the DOM, holding only Undo then Redo, apart from the wrapping content', () => {
    render(toolbar());
    const { header, slot } = parts();
    expect(header.tagName).toBe('HEADER');
    // First child of the bar, before the breadcrumb, name, badges, save status and actions.
    expect(header.firstElementChild).toBe(slot);
    const buttons = within(slot).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('data-history'))).toEqual(['undo', 'redo']);
    expectSameNodes([...slot.children], buttons);
    expect(slot).toContainElement(screen.getByRole('button', { name: 'Undo' }));
    // Nothing else lives in the slot, and nothing of the slot lives in the content.
    const content = slot.nextElementSibling!;
    expectSameNodes([...header.children], [slot, content]);
    expect(content).toContainElement(screen.getByRole('link', { name: 'Loops' }));
    expect(content).toContainElement(screen.getByRole('heading', { level: 1, name: 'loop' }));
    expect(content).toContainElement(screen.getByTestId('save-state'));
    expect(content).toContainElement(screen.getByRole('button', { name: 'Publish' }));
    expect(content).toContainElement(screen.getByText('Ready to publish'));
    for (const button of buttons) expect(content).not.toContainElement(button);
  });

  it('is a fixed, non-shrinking, top-aligned slot beside content that is allowed to wrap', () => {
    render(toolbar());
    const { header, slot } = parts();
    // The geometry itself is for native browsers; these are the declared rules that give it.
    expect(header).toHaveClass('flex', 'items-start');
    expect(header).not.toHaveClass('flex-wrap', 'items-center');
    expect(slot).toHaveClass('shrink-0', 'h-9', 'pointer-coarse:h-11', 'items-center', 'gap-2');
    expect(slot).not.toHaveClass('ml-auto', 'flex-wrap', 'justify-end', 'self-center');
    const content = slot.nextElementSibling!;
    expect(content).toHaveClass('min-w-0', 'flex-1', 'flex-wrap', 'items-center');
  });

  it('keeps Undo and Redo the first stops of the bar, ahead of the other controls, in both publish states', async () => {
    const user = userEvent.setup();
    const names = async () => {
      const found: string[] = [];
      // Undo and Redo are aria-disabled, not disabled, so they stay in the Tab order with no step.
      for (let stop = 0; stop < 5; stop += 1) {
        await user.tab();
        const active = document.activeElement as HTMLElement;
        found.push(active.getAttribute('data-history') ?? active.textContent ?? '');
      }
      return found;
    };
    const published = render(toolbar({ published: true }));
    expect(await names()).toEqual(['undo', 'redo', 'Loops', 'Open in Runs', 'Publish']);
    published.unmount();
    render(toolbar({ published: false }));
    (document.activeElement as HTMLElement).blur();
    expect(await names()).toEqual(['undo', 'redo', 'Loops', 'Open in Runs', 'Publish']);
  });

  it.each([...TRANSITIONS])(
    'leaves the very same slot and buttons untouched through %s',
    (_name, change) => {
      const view = render(toolbar());
      const { header, slot } = parts();
      const undo = screen.getByRole('button', { name: 'Undo' });
      const redo = screen.getByRole('button', { name: 'Redo' });
      const inside = [...slot.querySelectorAll('*')];
      view.rerender(toolbar(change));
      // The same elements, in the same place: React did not remount or move them.
      expect(parts().slot).toBe(slot);
      expect(parts().header).toBe(header);
      expect(header.firstElementChild).toBe(slot);
      expectSameNodes([...slot.children], [undo, redo]);
      expect(screen.getByRole('button', { name: 'Undo' })).toBe(undo);
      expect(screen.getByRole('button', { name: 'Redo' })).toBe(redo);
      // And none of the changing content went into the slot.
      expectSameNodes([...slot.querySelectorAll('*')], inside);
      expect(within(slot).queryByText(/Publish|errors|Saving|saved|Offline/)).toBeNull();
    },
  );

  it('keeps the slot and its buttons through the whole sequence of transitions, not just singly', () => {
    const view = render(toolbar());
    const { header, slot } = parts();
    const before = [...slot.querySelectorAll('*')];
    for (const [, change] of TRANSITIONS) {
      view.rerender(toolbar(change));
      expect(header.firstElementChild).toBe(slot);
      expectSameNodes([...slot.querySelectorAll('*')], before);
    }
    view.rerender(toolbar());
    expectSameNodes([...slot.querySelectorAll('*')], before);
  });

  it('names its buttons by the step they change and acts exactly once per activation', async () => {
    const user = userEvent.setup();
    render(toolbar());
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    for (const button of [undo, redo]) expect(button).toHaveAttribute('aria-disabled', 'true');
    // No step: pressing does nothing and focus stays on the pressed button.
    await user.click(undo);
    expect(undo).toHaveFocus();
    await user.click(redo);
    expect(redo).toHaveFocus();
    expect(store()).toMatchObject({ revision: 0, historyEpoch: 0 });

    act(() => store().moveNode('start', { x: 40, y: 80 }));
    expect(undo).toHaveAccessibleName('Undo move start');
    expect(undo).toHaveAttribute('title', 'Undo move start');
    expect(undo).not.toHaveAttribute('aria-disabled');
    const epoch = store().historyEpoch;
    await user.click(undo);
    expect(store().historyEpoch).toBe(epoch + 1);
    expect(store().definition!.nodes[0]!.ui).toEqual({ x: 0, y: 80 });
    expect(undo).toHaveFocus();
    expect(redo).toHaveAccessibleName('Redo move start');
    await user.click(redo);
    expect(store().historyEpoch).toBe(epoch + 2);
    expect(store().definition!.nodes[0]!.ui).toEqual({ x: 40, y: 80 });
    expect(redo).toHaveFocus();
    // The slot, its buttons and their attributes are the same after the history session.
    expect(parts().header.firstElementChild).toBe(parts().slot);
    expect(undo).toHaveAttribute('data-history', 'undo');
    expect(redo).toHaveAttribute('data-history', 'redo');
  });

  it('shows held field input as a segment of its own beside the draft’s state, in one stable focus target (#526)', () => {
    const view = render(toolbar({ saveState: 'saved' }));
    const status = screen.getByTestId('save-state');
    focusFallback(status);
    expect(status).toHaveFocus();
    expect(status).toHaveTextContent('All changes saved');
    expect(screen.queryByTestId('held-input-state')).toBeNull();

    view.rerender(toolbar({ saveState: 'saved', heldInput: true }));
    expect(screen.getByTestId('save-state')).toBe(status);
    expect(status).toHaveFocus();
    expect(status).toHaveClass('flex-wrap');
    expect(screen.getByTestId('draft-state')).toHaveTextContent(/^Draft saved$/);
    expect(screen.getByTestId('held-input-state')).toHaveTextContent(
      'Field input kept in this window only',
    );
    expect(status).not.toHaveTextContent('All changes saved');
    // Read as two sentences, the draft's first.
    expect(status.textContent).toBe('Draft saved. Field input kept in this window only');

    // The device copy and other states keep their distinctions beside it.
    view.rerender(toolbar({ saveState: 'invalid', device: 'memory', heldInput: true }));
    expect(screen.getByTestId('draft-state')).toHaveTextContent('Draft kept in this window only');
    view.rerender(toolbar({ saveState: 'offline', device: 'device', heldInput: true }));
    expect(screen.getByTestId('draft-state')).toHaveTextContent(
      'Offline: draft saved on this device',
    );
    view.rerender(toolbar({ saveState: 'conflict', heldInput: true }));
    expect(screen.getByTestId('draft-state')).toHaveTextContent('Draft changed elsewhere');
    // Before any save, only the field input is spoken of.
    view.rerender(toolbar({ saveState: 'idle', heldInput: true }));
    expect(screen.queryByTestId('draft-state')).toBeNull();
    expect(status.textContent).toBe('Field input kept in this window only');

    view.rerender(toolbar({ saveState: 'saved' }));
    expect(screen.getByTestId('save-state')).toBe(status);
    expect(status).toHaveFocus();
    expect(status.textContent).toBe('All changes saved');
  });

  it('keeps every other control and its behaviour of the bar', async () => {
    const onPublish = vi.fn();
    const user = userEvent.setup();
    render(toolbar({ onPublish, errors: 2 }));
    expect(screen.getByRole('link', { name: 'Loops' })).toHaveAttribute('href', '/loops');
    expect(screen.getByRole('link', { name: 'Open in Runs' })).toHaveAttribute(
      'href',
      expect.stringContaining('L1'),
    );
    expect(screen.getByText('published v1')).toBeInTheDocument();
    expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved');
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toHaveAttribute('title', '2 validation error(s) will block publishing');
    await user.click(publish);
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});
