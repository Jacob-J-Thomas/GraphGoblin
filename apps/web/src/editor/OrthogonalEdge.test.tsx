import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  getSmoothStepPath,
  Position,
  ReactFlowProvider,
  useStoreApi,
  type EdgeProps,
} from '@xyflow/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { notePlacement, OrthogonalEdge, type OrthogonalFlowEdge } from './OrthogonalEdge.js';
import { RouteEditingContext, type RouteEditing } from './route-editing.js';
import type { RoutedEdge } from './routing.js';
import { createRouteChannels } from './route-channels.js';
import { labelBox } from './edge-label-placement.js';
import { ForwardEdge } from './ForwardEdge.js';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { VOICE_STEP_MESSAGE } from './chat-protection.js';
import { useEditorStore } from './store.js';
import { createViewportGestureGate } from './viewport-gesture.js';

const data = (
  route: RoutedEdge | undefined,
  extra: { forward?: boolean; suspended?: boolean } = {},
) => ({
  channel: createRouteChannels().edge('return', route),
  forward: extra.forward ?? false,
  suspended: extra.suspended ?? false,
});

const route: RoutedEdge = {
  points: [
    { x: 100, y: 0 },
    { x: 130, y: 0 },
    { x: 130, y: 180 },
    { x: -20, y: 180 },
    { x: -20, y: 40 },
    { x: 0, y: 40 },
  ],
  label: { x: 55, y: 180 },
  labelWidth: 118,
  blocked: false,
  unavailable: false,
  radius: 8,
  radii: [0, 8, 8, 8, 8, 0],
  padding: 32,
  lanePadding: 32,
  bounds: { id: '', left: -20, right: 130, top: 0, bottom: 180 },
};
const props: EdgeProps<OrthogonalFlowEdge> = {
  id: 'return',
  source: 'done',
  target: 'work',
  sourceX: 100,
  sourceY: 0,
  targetX: 0,
  targetY: 40,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  data: data(route),
  label: 'loopBack',
  selected: false,
  selectable: true,
  deletable: true,
};

beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: vi.fn(() => ({ x: 0, y: 0, width: 56, height: 11 })),
  });
});

/** The edge inside xyflow's focusable edge wrapper, with a route editor. */
function inFlow(children: ReactNode, editing: RouteEditing | undefined = undefined) {
  return (
    <ReactFlowProvider>
      <RouteEditingContext value={editing}>
        <svg>
          <g className="react-flow__edge" tabIndex={0} data-testid="edge">
            {children}
          </g>
        </svg>
      </RouteEditingContext>
    </ReactFlowProvider>
  );
}

const editor = (viewport: RouteEditing['viewport'] = createViewportGestureGate()) => ({
  begin: vi.fn<RouteEditing['begin']>(),
  nudge: vi.fn<RouteEditing['nudge']>(() => undefined),
  reset: vi.fn<RouteEditing['reset']>(),
  remove: vi.fn<RouteEditing['remove']>(),
  viewport,
});

describe('OrthogonalEdge', () => {
  it('uses the stock smoothstep renderer for a clear forward label, and a channel only for a shifted one', () => {
    const plain = { ...props };
    delete plain.data;
    const view = render(inFlow(<ForwardEdge {...plain} />));
    expect(view.container.querySelector('.react-flow__edge-text')).toHaveTextContent('loopBack');
    expect(view.container.querySelector('.react-flow__edge-path')).toBeInTheDocument();
    view.rerender(inFlow(<ForwardEdge {...props} />));
    expect(view.container.querySelector('.react-flow__edge-path')?.getAttribute('d')).toContain(
      'Q',
    );
  });
  it('retains routed label shortening when a collision placement is present', () => {
    const at = { x: 200, y: -100 };
    const text = 'A long port name that cannot fit on this route';
    const channel = createRouteChannels().edge('return', route, {
      at,
      box: labelBox('return', text, at),
    });
    const view = render(
      inFlow(
        <OrthogonalEdge
          {...props}
          label={text}
          data={{ channel, forward: false, suspended: false }}
        />,
      ),
    );
    expect(view.container.querySelector('.react-flow__edge-text')?.textContent).toMatch(/…$/);
    expect(view.container.querySelector('title')).toHaveTextContent(text);
  });
  it('uses the shared label position, full text and a leader when the path has no room', () => {
    const at = { x: 200, y: -100 };
    const channel = createRouteChannels().edge('return', route, {
      at,
      box: labelBox('return', 'Finish', at),
      anchor: { x: 55, y: 180 },
    });
    const view = render(
      inFlow(
        <OrthogonalEdge
          {...props}
          label="Finish"
          data={{ channel, forward: false, suspended: false }}
        />,
      ),
    );
    const label = view.container.querySelector('.react-flow__edge-textwrapper')!;
    // xyflow places the mocked 56x11 text box with its centre at the requested point.
    expect(label.getAttribute('transform')).toBe('translate(172 -105.5)');
    expect(label.textContent).toContain('Finish');
    expect(view.container.querySelector('.gg-edge-label-leader')).toHaveAttribute(
      'd',
      'M 55 180 L 200 -100',
    );
  });

  it('draws rounded geometry, a label on the lane, and xyflow hit targets', () => {
    const view = render(
      <svg>
        <OrthogonalEdge {...props} />
      </svg>,
    );
    const path = view.container.querySelector('.react-flow__edge-path')!;
    expect(path.getAttribute('d')).toContain('Q');
    expect(view.container.querySelector('.react-flow__edge-interaction')).toHaveAttribute(
      'd',
      path.getAttribute('d'),
    );
    expect(view.container.querySelector('.react-flow__edge-text')).toHaveTextContent('loopBack');
    expect(view.container.querySelector('.react-flow__edge-textwrapper')).toHaveAttribute(
      'transform',
      'translate(27 174.5)',
    );
    // Unselected: no handles, even with a route editor.
    expect(view.container.querySelector('.gg-route-handle')).toBeNull();
  });

  it('shortens long labels to the straight segment and preserves their full title', () => {
    const label = 'a-very-long-decision-route-label-that-would-cross-a-corner';
    const view = render(
      <svg>
        <OrthogonalEdge {...props} label={label} />
      </svg>,
    );
    expect(view.container.querySelector('title')).toHaveTextContent(label);
    expect(view.container.querySelector('.react-flow__edge-text')!.textContent).toMatch(/…$/);
    view.rerender(
      <svg>
        <OrthogonalEdge {...props} label={label} data={data({ ...route, labelWidth: 7 })} />
      </svg>,
    );
    expect(view.container.querySelector('.react-flow__edge-text')).toHaveTextContent(/^…$/);
    view.rerender(
      <svg>
        <OrthogonalEdge {...props} label={undefined} />
      </svg>,
    );
    expect(view.container.querySelector('.react-flow__edge-text')).toBeNull();
    const { data: _data, ...unmeasured } = props;
    view.rerender(
      <svg>
        <OrthogonalEdge {...unmeasured} />
      </svg>,
    );
    expect(view.container.querySelector('path')).toBeNull();
  });

  it('keeps an obstructed connection labelled without a colliding path', () => {
    const view = render(
      <svg>
        <OrthogonalEdge
          {...props}
          label={undefined}
          data={data({ ...route, points: [], radii: [], blocked: true })}
        />
      </svg>,
    );
    expect(view.container.querySelector('.react-flow__edge-path')).toHaveAttribute('d', '');
    expect(view.container.querySelector('.react-flow__edge-text')).toHaveTextContent(
      'Connection: Port covered by a card; move the card',
    );
  });

  it('draws a forward edge without a route exactly as xyflow’s smoothstep, labelled at its centre', () => {
    const forward = { ...props, sourceX: 0, sourceY: 0, targetX: 300, targetY: 120, label: 'yes' };
    const view = render(
      <svg>
        <OrthogonalEdge {...forward} data={data(undefined, { forward: true })} />
      </svg>,
    );
    const [smooth, x, y] = getSmoothStepPath({
      sourceX: 0,
      sourceY: 0,
      sourcePosition: Position.Right,
      targetX: 300,
      targetY: 120,
      targetPosition: Position.Left,
      borderRadius: 10,
    });
    expect(view.container.querySelector('.react-flow__edge-path')).toHaveAttribute('d', smooth);
    expect(view.container.querySelector('.react-flow__edge-textwrapper')).toHaveAttribute(
      'transform',
      `translate(${x - 28} ${y - 5.5})`,
    );
  });

  it('shows a handle per segment of a selected edge; arrows on the matching axis nudge it', () => {
    const editing = editor();
    render(inFlow(<OrthogonalEdge {...props} selected />, editing));
    const handles = screen.getAllByRole('button', { name: /^Route segment/ });
    // from → 130 → down → lane → up → to: five segments, alternating axes.
    expect(handles.map((h) => h.getAttribute('aria-label'))).toEqual([
      'Route segment 1 of 5, horizontal',
      'Route segment 2 of 5, vertical',
      'Route segment 3 of 5, horizontal',
      'Route segment 4 of 5, vertical',
      'Route segment 5 of 5, horizontal',
    ]);
    expect(handles[1]).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight');
    expect(handles[1]).toHaveAttribute('tabindex', '0');
    expect(handles[1]!.getAttribute('class')).toContain('nokey');
    // A lane too short to hold the handle beside its pill keeps it at the middle.
    expect(handles[2]!.getAttribute('transform')).toBe('translate(55 180) scale(1)');
    // Up and Down do nothing to a vertical segment; Right nudges it one grid line.
    fireEvent.keyDown(handles[1]!, { key: 'ArrowUp' });
    expect(editing.nudge).not.toHaveBeenCalled();
    fireEvent.keyDown(handles[1]!, { key: 'ArrowRight' });
    fireEvent.keyDown(handles[2]!, { key: 'ArrowDown', shiftKey: true });
    expect(
      editing.nudge.mock.calls.map(([id, , segment, direction, steps]) => [
        id,
        segment.index,
        direction,
        steps,
      ]),
    ).toEqual([
      ['return', 2, 1, 1],
      ['return', 3, 1, 5],
    ]);
    expect(editing.nudge.mock.calls[0]![1]).toEqual({
      route: [130, 180, -20],
      from: { x: 100, y: 0 },
      to: { x: 0, y: 40 },
    });
    // Modified arrows belong to someone else (Ctrl+arrow, for example).
    fireEvent.keyDown(handles[1]!, { key: 'ArrowRight', ctrlKey: true });
    expect(editing.nudge).toHaveBeenCalledTimes(2);
  });

  it('moves a lane handle aside from the label pill when the lane has room', () => {
    const wide: RoutedEdge = {
      ...route,
      points: [
        { x: 100, y: 0 },
        { x: 130, y: 0 },
        { x: 130, y: 180 },
        { x: -200, y: 180 },
        { x: -200, y: 40 },
        { x: 0, y: 40 },
      ],
      label: { x: -35, y: 180 },
      labelBounds: { id: '', left: -72, right: 2, top: 169, bottom: 191 },
    };
    render(inFlow(<OrthogonalEdge {...props} data={data(wide)} selected />, editor()));
    const lane = screen.getByRole('button', { name: 'Route segment 3 of 5, horizontal' });
    expect(lane).toHaveAttribute('transform', 'translate(-143 180) scale(1)');
  });

  it('never deletes from a handle, returns to the edge on Escape, and starts a drag on press', () => {
    const editing = editor();
    const onKeyDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>{inFlow(<OrthogonalEdge {...props} selected />, editing)}</div>,
    );
    const handle = screen.getByRole('button', { name: 'Route segment 3 of 5, horizontal' });
    for (const key of ['Delete', 'Backspace', 'Enter', ' ']) fireEvent.keyDown(handle, { key });
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: 'Tab' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    handle.focus();
    fireEvent.keyDown(handle, { key: 'Escape' });
    expect(screen.getByTestId('edge')).toHaveFocus();
    fireEvent.pointerDown(handle, { button: 2, clientX: 5, clientY: 6 });
    expect(editing.begin).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { button: 0, clientX: 5, clientY: 6 });
    expect(editing.begin).toHaveBeenCalledWith(
      'return',
      expect.objectContaining({ route: [130, 180, -20] }),
      expect.objectContaining({ index: 3, axis: 'y', value: 180 }),
      expect.objectContaining({ clientX: 5, clientY: 6 }),
    );
    expect(handle).toHaveFocus();
    // Without a manual route there is nothing to reset.
    expect(screen.queryByRole('button', { name: 'Reset route' })).toBeNull();
  });

  it('keeps focus on a nudged segment, even when the nudge renumbered it', () => {
    const editing = editor();
    const view = render(inFlow(<OrthogonalEdge {...props} selected />, editing));
    const first = screen.getByRole('button', { name: 'Route segment 1 of 5, horizontal' });
    first.focus();
    // The first segment splits: its stub stays and the moved part becomes segment 3.
    editing.nudge.mockReturnValue({
      index: 3,
      axis: 'y',
      value: 22,
      kind: 'inner',
      a: { x: 108, y: 22 },
      b: { x: 130, y: 22 },
    });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const next: RoutedEdge = {
      ...route,
      points: [
        { x: 100, y: 0 },
        { x: 108, y: 0 },
        { x: 108, y: 22 },
        { x: 130, y: 22 },
        { x: 130, y: 180 },
        { x: -20, y: 180 },
        { x: -20, y: 40 },
        { x: 0, y: 40 },
      ],
      radii: [0, 8, 8, 8, 8, 8, 8, 0],
      manual: true,
    };
    act(() => {
      view.rerender(inFlow(<OrthogonalEdge {...props} data={data(next)} selected />, editing));
    });
    expect(screen.getByRole('button', { name: 'Route segment 3 of 7, horizontal' })).toHaveFocus();
  });

  it('offers Reset route for a manual route, and says when it crosses a card', () => {
    const editing = editor();
    const view = render(
      inFlow(
        <OrthogonalEdge {...props} data={data({ ...route, manual: true })} selected />,
        editing,
      ),
    );
    const reset = screen.getByRole('button', { name: 'Reset route' });
    fireEvent.keyDown(reset, { key: 'Delete' });
    fireEvent.click(reset);
    expect(editing.reset).toHaveBeenCalledWith('return');
    expect(screen.getByTestId('edge')).toHaveFocus();
    reset.focus();
    fireEvent.keyDown(reset, { key: 'Escape' });
    expect(screen.getByTestId('edge')).toHaveFocus();
    expect(screen.queryByText('Crosses a card')).toBeNull();
    // A route the author left across a card is drawn dotted and says so.
    view.rerender(
      inFlow(
        <OrthogonalEdge
          {...props}
          data={data({ ...route, manual: true, crossing: true })}
          selected
        />,
        editing,
      ),
    );
    expect(view.container.querySelector('.react-flow__edge-path')).toHaveClass('gg-route-crossing');
    expect(screen.getByText('Crosses a card')).toBeInTheDocument();
    // A manual route set aside under a moving card draws the automatic path, still resettable.
    view.rerender(
      inFlow(
        <OrthogonalEdge
          {...props}
          sourceX={0}
          targetX={300}
          data={data(undefined, { forward: true, suspended: true })}
          selected
        />,
        editing,
      ),
    );
    expect(screen.getByRole('button', { name: 'Reset route' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Route segment/ }).length).toBeGreaterThan(0);
  });

  it('offers Remove connection on every selected edge, keeping its keys from the edge and canvas (#207)', () => {
    useEditorStore.setState({ definition: undefined, systemChat: false });
    const editing = editor();
    const onKeyDown = vi.fn();
    // xyflow's edge wrapper selects its edge in a React click handler on an ancestor.
    const onClick = vi.fn();
    const view = render(
      <div onKeyDown={onKeyDown} onClick={onClick}>
        {inFlow(<OrthogonalEdge {...props} />, editing)}
      </div>,
    );
    // Unselected: no toolbar.
    expect(screen.queryByRole('button', { name: 'Remove connection' })).toBeNull();
    view.rerender(
      <div onKeyDown={onKeyDown} onClick={onClick}>
        {inFlow(<OrthogonalEdge {...props} selected />, editing)}
      </div>,
    );
    // An automatic route has nothing to reset, but its connection can be removed.
    expect(screen.queryByRole('button', { name: 'Reset route' })).toBeNull();
    const remove = screen.getByRole('button', { name: 'Remove connection' });
    expect(remove).toBeEnabled();
    expect(remove).toHaveClass('nokey', 'nodrag', 'nopan', 'pointer-coarse:h-11');
    for (const key of ['Delete', 'Backspace', 'Enter', ' ']) fireEvent.keyDown(remove, { key });
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(editing.remove).not.toHaveBeenCalled();
    remove.focus();
    fireEvent.keyDown(remove, { key: 'Escape' });
    expect(screen.getByTestId('edge')).toHaveFocus();
    // The edge wrapper never sees the click (it would select the removed edge again).
    fireEvent.click(remove);
    expect(editing.remove).toHaveBeenCalledWith('return');
    expect(onClick).not.toHaveBeenCalled();
    // A manual route that crosses a card: the note, Reset route, then Remove connection.
    view.rerender(
      <div onKeyDown={onKeyDown}>
        {inFlow(
          <OrthogonalEdge
            {...props}
            data={data({ ...route, manual: true, crossing: true })}
            selected
          />,
          editing,
        )}
      </div>,
    );
    const toolbar = view.container.querySelector('.gg-route-toolbar')!;
    expect([...toolbar.children].map((child) => child.textContent)).toEqual([
      'Crosses a card',
      'Reset route',
      'Remove connection',
    ]);
  });

  it('disables Remove connection on a protected Chat voice step, saying why (#207)', () => {
    useEditorStore.setState({
      systemChat: true,
      definition: {
        schemaVersion: 4,
        name: 'Chat',
        nodes: [
          { id: 'chat-input', kind: 'trigger', label: 'In', config: { type: 'manual' } },
          { id: 'chat-normalize', kind: 'mutate', label: 'Norm', config: { operations: [] } },
        ],
        edges: [
          {
            id: 'return',
            from: { node: 'chat-input', port: 'out' },
            to: { node: 'chat-normalize' },
          },
        ],
      } as unknown as LoopDefinitionInput,
    });
    const editing = editor();
    render(inFlow(<OrthogonalEdge {...props} selected />, editing));
    const remove = screen.getByRole('button', { name: 'Remove connection' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', VOICE_STEP_MESSAGE);
    fireEvent.click(remove);
    expect(editing.remove).not.toHaveBeenCalled();
    act(() => useEditorStore.setState({ systemChat: false }));
    expect(screen.getByRole('button', { name: 'Remove connection' })).toBeEnabled();
    useEditorStore.setState({ definition: undefined, systemChat: false });
  });

  it('keeps Reset route and Remove connection visibly unavailable while a mouse pan settles (#207)', async () => {
    useEditorStore.setState({ definition: undefined, systemChat: false });
    const gate = createViewportGestureGate();
    const detach = gate.attach(window);
    const editing = editor(gate);
    // xyflow's edge wrapper selects its edge in a React click handler on an ancestor.
    const onClick = vi.fn();
    try {
      render(
        <div onClick={onClick}>
          {inFlow(
            <OrthogonalEdge {...props} data={data({ ...route, manual: true })} selected />,
            editing,
          )}
        </div>,
      );
      const reset = screen.getByRole('button', { name: 'Reset route' });
      const remove = screen.getByRole('button', { name: 'Remove connection' });
      const buttons = [reset, remove];
      // A new canvas starts ready; wheel, touch and programmatic moves never add d3's blocker.
      act(() => {
        gate.move(new WheelEvent('wheel'));
        gate.move(new Event('touchmove'));
        gate.move(null);
      });
      for (const button of buttons) {
        expect(button).not.toHaveAttribute('aria-disabled');
        expect(button).not.toHaveAttribute('data-gesture');
      }

      act(() => gate.move(new MouseEvent('mousemove')));
      for (const button of buttons) {
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveAttribute('data-gesture', 'panning');
        // A real hit target that keeps focus and `nopan`, not a disabled button a press falls
        // through; no message: the drag in progress is the reason.
        expect(button).toBeEnabled();
        expect(button).not.toHaveAttribute('title');
      }
      remove.focus();
      fireEvent.click(remove);
      expect(editing.remove).not.toHaveBeenCalled();
      // The refused click stays on the button, as an accepted one does.
      expect(onClick).not.toHaveBeenCalled();
      expect(remove).toHaveFocus();
      fireEvent.click(reset);
      expect(editing.reset).not.toHaveBeenCalled();

      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      });
      for (const button of buttons) expect(button).toHaveAttribute('data-gesture', 'settling');
      // A task queued now runs after the barrier's first task, which enables nothing; d3's cleanup,
      // queued in the same release, would have run by then too. The handlers agree.
      const afterFirst = await new Promise<string | null>((resolve) =>
        setTimeout(() => {
          fireEvent.click(remove);
          fireEvent.click(reset);
          resolve(remove.getAttribute('data-gesture'));
        }, 0),
      );
      expect(afterFirst).toBe('settling');
      expect(editing.remove).not.toHaveBeenCalled();
      expect(editing.reset).not.toHaveBeenCalled();
      // The second task makes both available again.
      await waitFor(() => expect(remove).not.toHaveAttribute('aria-disabled'));
      expect(reset).not.toHaveAttribute('aria-disabled');
      expect(reset).not.toHaveAttribute('data-gesture');
      fireEvent.click(remove);
      expect(editing.remove).toHaveBeenCalledTimes(1);
      expect(editing.remove).toHaveBeenCalledWith('return');
      fireEvent.click(reset);
      expect(editing.reset).toHaveBeenCalledTimes(1);
    } finally {
      detach();
    }
  });

  it.each([
    ['an ordinary draft', false, false],
    ['a Chat draft, the voice step stored first', true, true],
    ['a Chat draft, the voice step stored second', true, false],
  ])(
    'keeps Remove connection focusable but unavailable for an id two stored connections hold, under a note saying why, in %s (#207, #481)',
    async (_, system, voiceFirst) => {
      const voice = {
        id: 'return',
        from: { node: 'chat-input', port: 'out' },
        to: { node: 'chat-normalize' },
      };
      const plain = { id: 'return', from: { node: 'respond', port: 'out' }, to: { node: 'done' } };
      const definition = {
        schemaVersion: 4,
        name: 'Shared id',
        nodes: [
          { id: 'chat-input', kind: 'trigger', label: 'In', config: { type: 'manual' } },
          { id: 'chat-normalize', kind: 'mutate', label: 'Norm', config: { operations: [] } },
          { id: 'respond', kind: 'mutate', label: 'Respond', config: { operations: [] } },
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
        edges: voiceFirst ? [voice, plain] : [plain, voice],
      } as unknown as LoopDefinitionInput;
      useEditorStore.setState({ systemChat: system, definition });
      const message =
        'More than one connection uses the ID "return", so the editor cannot tell which one you mean. To repair it, remove a Decision route one of them starts from (its review should list just that connection), add the route back and draw its connection again, until one keeps the ID. Otherwise, or without a pointer, correct the ID with PUT /loops/{id}/draft.';
      const gate = createViewportGestureGate();
      const editing = editor(gate);
      // xyflow's edge wrapper selects its edge in a React click handler on an ancestor.
      const onClick = vi.fn();
      const user = userEvent.setup();
      try {
        render(
          <div onClick={onClick}>{inFlow(<OrthogonalEdge {...props} selected />, editing)}</div>,
        );
        const remove = screen.getByRole('button', { name: 'Remove connection' });
        // The reason shows as soon as the connection is selected, before any refused action:
        // a note above the row of controls, outside it.
        const note = screen.getByText(message);
        expect(note).toHaveClass('gg-route-note', 'nodrag', 'nopan');
        expect(note.closest('.gg-route-toolbar')).toBeNull();
        // Not a disabled button a press falls through: a hit target that keeps focus, unavailable
        // and described by the note, with no tooltip repeating it.
        expect(remove).toBeEnabled();
        expect(remove).toHaveAttribute('aria-disabled', 'true');
        expect(remove).toHaveAttribute('aria-describedby', note.id);
        expect(remove).toHaveAccessibleDescription(message);
        expect(remove).not.toHaveAttribute('title');
        // A click, element.click(), Enter and Space change nothing and end on the button, where
        // focus stays.
        remove.focus();
        for (const detail of [0, 1]) fireEvent.click(remove, { detail });
        remove.click();
        await user.keyboard('{Enter}');
        await user.keyboard(' ');
        expect(editing.remove).not.toHaveBeenCalled();
        expect(onClick).not.toHaveBeenCalled();
        expect(remove).toHaveFocus();
        // A later click of a double click returns focus to the connection, as on any connection.
        fireEvent.click(remove, { detail: 2 });
        expect(screen.getByTestId('edge')).toHaveFocus();
        expect(editing.remove).not.toHaveBeenCalled();
        // The store's reason outranks a pan in progress, as the voice step's does.
        act(() => gate.move(new MouseEvent('mousemove')));
        expect(remove).toHaveAttribute('aria-disabled', 'true');
        expect(remove).not.toHaveAttribute('data-gesture');
        expect(remove).toHaveAccessibleDescription(message);
        // One holder again: an ordinary connection may go (here once the pan settles), with no
        // note; the voice step keeps its own reason, natively disabled as before.
        act(() => useEditorStore.setState({ definition: { ...definition, edges: [plain] } }));
        expect(remove).toBeEnabled();
        expect(remove).not.toHaveAttribute('title');
        expect(remove).not.toHaveAttribute('aria-describedby');
        expect(remove).toHaveAttribute('data-gesture', 'panning');
        expect(screen.queryByText(message)).toBeNull();
        act(() => useEditorStore.setState({ definition: { ...definition, edges: [voice] } }));
        expect(remove.getAttribute('title')).toBe(system ? VOICE_STEP_MESSAGE : null);
        if (system) expect(remove).toBeDisabled();
        expect(screen.queryByText(message)).toBeNull();
      } finally {
        useEditorStore.setState({ definition: undefined, systemChat: false });
      }
    },
  );

  it('describes Reset route and the handles of a shared id by the same note, which leaves the row where it was (#481)', () => {
    const own = { id: 'return', from: { node: 'done', port: 'out' }, to: { node: 'work' } };
    const other = { id: 'return', from: { node: 'start', port: 'out' }, to: { node: 'work' } };
    const definition = {
      schemaVersion: 4,
      name: 'Shared id',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'work', kind: 'mutate', label: 'Work', config: { operations: [] } },
        { id: 'done', kind: 'mutate', label: 'Done', config: { operations: [] } },
      ],
      edges: [other, own],
    } as unknown as LoopDefinitionInput;
    useEditorStore.setState({ systemChat: false, definition });
    const message =
      'More than one connection uses the ID "return", so the editor cannot tell which one you mean. To repair it, remove a Decision route one of them starts from (its review should list just that connection), add the route back and draw its connection again, until one keeps the ID. Otherwise, or without a pointer, correct the ID with PUT /loops/{id}/draft.';
    const editing = editor();
    const onClick = vi.fn();
    try {
      const view = render(
        <div onClick={onClick}>
          {inFlow(
            <OrthogonalEdge {...props} data={data({ ...route, manual: true })} selected />,
            editing,
          )}
        </div>,
      );
      const frame = view.container.querySelector('foreignObject')!;
      const toolbar = view.container.querySelector('.gg-route-toolbar')!;
      const note = screen.getByText(message);
      // The row of controls is unchanged and still ends at the frame's bottom, centred on the
      // label; the frame grows upward to hold the note above it, and sideways so it can move. (The
      // pane is unmeasured here, so the note is centred at the toolbar's width.)
      expect([...toolbar.children].map((child) => child.textContent)).toEqual([
        'Reset route',
        'Remove connection',
      ]);
      expect(note.nextElementSibling).toBe(toolbar);
      expect(frame).toHaveAttribute('x', String(-420));
      expect(frame).toHaveAttribute('width', String(2 * 420));
      expect(frame).toHaveAttribute('y', String(-(48 + 240)));
      expect(frame).toHaveAttribute('height', String(48 + 240));
      expect(note).toHaveStyle({ width: '420px' });
      const reset = screen.getByRole('button', { name: 'Reset route' });
      expect(reset).toBeEnabled();
      expect(reset).toHaveAttribute('aria-disabled', 'true');
      expect(reset).toHaveAccessibleDescription(message);
      expect(reset).not.toHaveAttribute('title');
      expect(reset).not.toHaveAttribute('data-gesture');
      // A click resets nothing and holds nothing: focus stays on the button.
      reset.focus();
      for (const detail of [0, 1, 2]) fireEvent.click(reset, { detail });
      expect(editing.reset).not.toHaveBeenCalled();
      expect(onClick).not.toHaveBeenCalled();
      expect(reset).toHaveFocus();
      fireEvent.keyDown(reset, { key: 'Escape' });
      expect(screen.getByTestId('edge')).toHaveFocus();
      // The handles stay focusable and unavailable, described by the same note.
      for (const handle of screen.getAllByRole('button', { name: /^Route segment/ })) {
        expect(handle).toHaveAttribute('aria-disabled', 'true');
        expect(handle).not.toHaveAttribute('aria-description');
        expect(handle).toHaveAccessibleDescription(message);
      }

      // One holder again: no note, the frame as it was, and the controls available.
      act(() => useEditorStore.setState({ definition: { ...definition, edges: [own] } }));
      expect(screen.queryByText(message)).toBeNull();
      expect(frame).toHaveAttribute('x', String(-210));
      expect(frame).toHaveAttribute('width', '420');
      expect(frame).toHaveAttribute('y', '-48');
      expect(frame).toHaveAttribute('height', '48');
      for (const button of [reset, screen.getByRole('button', { name: 'Remove connection' })]) {
        expect(button).toBeEnabled();
        expect(button).not.toHaveAttribute('aria-disabled');
        expect(button).not.toHaveAttribute('aria-describedby');
      }
      const handle = screen.getAllByRole('button', { name: /^Route segment/ })[0]!;
      expect(handle).not.toHaveAttribute('aria-disabled');
      expect(handle).not.toHaveAttribute('aria-describedby');
      expect(handle.getAttribute('aria-description')).toMatch(/arrows move it one grid step/);
      fireEvent.click(reset, { detail: 1 });
      expect(editing.reset).toHaveBeenCalledWith('return');
    } finally {
      useEditorStore.setState({ definition: undefined, systemChat: false });
    }
  });

  it('moves a shared id’s note inside a narrow pane, and below the label when there is no room above it (#481)', () => {
    const own = { id: 'return', from: { node: 'done', port: 'out' }, to: { node: 'work' } };
    const other = { id: 'return', from: { node: 'start', port: 'out' }, to: { node: 'work' } };
    useEditorStore.setState({
      systemChat: false,
      definition: {
        schemaVersion: 4,
        name: 'Shared id',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          { id: 'work', kind: 'mutate', label: 'Work', config: { operations: [] } },
          { id: 'done', kind: 'mutate', label: 'Done', config: { operations: [] } },
        ],
        edges: [other, own],
      } as unknown as LoopDefinitionInput,
    });
    let flowStore: ReturnType<typeof useStoreApi> | undefined;
    function FlowStore() {
      flowStore = useStoreApi();
      return null;
    }
    try {
      const view = render(
        inFlow(
          <>
            <FlowStore />
            <OrthogonalEdge {...props} selected />
          </>,
          editor(),
        ),
      );
      // A 390 px pane panned so the label (55, 180) sits 30 px from its top.
      act(() => flowStore!.setState({ width: 390, height: 600, transform: [0, -150, 1] }));
      const note = view.container.querySelector<HTMLElement>('.gg-route-note')!;
      const [toolbarFrame, noteFrame] = view.container.querySelectorAll('foreignObject');
      // The note is below the label, in its own frame; the controls' frame is as without a note.
      expect(noteFrame!.contains(note)).toBe(true);
      expect(noteFrame).toHaveAttribute('y', '0');
      expect(toolbarFrame).toHaveAttribute('width', '420');
      expect(toolbarFrame).toHaveAttribute('height', '48');
      // As wide as the pane less its margins, and moved right to start inside it.
      expect(note).toHaveStyle({ width: '374px', transform: 'translateX(140px)' });
      // The controls are still described by it.
      expect(screen.getByRole('button', { name: 'Remove connection' })).toHaveAttribute(
        'aria-describedby',
        note.id,
      );
      // Panned back down, there is room above again: the note returns over the controls.
      act(() => flowStore!.setState({ transform: [0, 300, 1] }));
      const above = view.container.querySelector<HTMLElement>('.gg-route-note')!;
      expect(view.container.querySelectorAll('foreignObject')).toHaveLength(1);
      expect(above.nextElementSibling).toBe(view.container.querySelector('.gg-route-toolbar'));
    } finally {
      useEditorStore.setState({ definition: undefined, systemChat: false });
    }
  });

  it('keeps a protected voice step’s own reason while a pan settles (#207)', () => {
    useEditorStore.setState({
      systemChat: true,
      definition: {
        schemaVersion: 4,
        name: 'Chat',
        nodes: [
          { id: 'chat-input', kind: 'trigger', label: 'In', config: { type: 'manual' } },
          { id: 'chat-normalize', kind: 'mutate', label: 'Norm', config: { operations: [] } },
        ],
        edges: [
          {
            id: 'return',
            from: { node: 'chat-input', port: 'out' },
            to: { node: 'chat-normalize' },
          },
        ],
      } as unknown as LoopDefinitionInput,
    });
    const gate = createViewportGestureGate();
    const editing = editor(gate);
    render(inFlow(<OrthogonalEdge {...props} selected />, editing));
    act(() => gate.move(new MouseEvent('mousemove')));
    const remove = screen.getByRole('button', { name: 'Remove connection' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', VOICE_STEP_MESSAGE);
    expect(remove).not.toHaveAttribute('aria-disabled');
    expect(remove).not.toHaveAttribute('data-gesture');
    fireEvent.click(remove);
    expect(editing.remove).not.toHaveBeenCalled();
    useEditorStore.setState({ definition: undefined, systemChat: false });
  });
});

/**
 * Reset route keeps the toolbar where it was clicked (#207). A double click's second press lands on
 * the point of the first: were the toolbar recentred on the automatic label with Reset route gone,
 * Remove connection would sit under that point. These tests drive the real component, its route
 * channel and the browser's click and key sequences; they assert what is rendered, never where a
 * browser would hit-test (jsdom has no layout).
 */
describe('Reset route keeps its toolbar where it was clicked (#207)', () => {
  const MESSAGE = 'The connection already routes automatically.';
  const manual: RoutedEdge = { ...route, manual: true };
  /** The router's route for the same loop-back: its label, and so the centred toolbar, is elsewhere. */
  const automatic: RoutedEdge = {
    ...route,
    points: [
      { x: 100, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 120 },
      { x: -10, y: 120 },
      { x: -10, y: 40 },
      { x: 0, y: 40 },
    ],
    label: { x: 40, y: 120 },
  };
  /** Another manual route, as a nudge or a drag of a handle draws one. */
  const nudged: RoutedEdge = {
    ...manual,
    points: [
      { x: 100, y: 0 },
      { x: 130, y: 0 },
      { x: 130, y: 200 },
      { x: -20, y: 200 },
      { x: -20, y: 40 },
      { x: 0, y: 40 },
    ],
    label: { x: 70, y: 200 },
  };
  type Label = { x: number; y: number };
  /** Where the toolbar goes for a label at `at`, at zoom 1. */
  const above = (at: Label) => `translate(${at.x} ${at.y - 18}) scale(1)`;
  const placed = (container: HTMLElement) =>
    container.querySelector('foreignObject')!.parentElement!.getAttribute('transform');
  const toolbar = (container: HTMLElement) =>
    [...container.querySelector('.gg-route-toolbar')!.children].map((child) => child.textContent);
  const labelAt = (container: HTMLElement) =>
    container.querySelector('.react-flow__edge-textwrapper')!.getAttribute('transform');

  beforeEach(() => {
    useEditorStore.setState({ definition: undefined, systemChat: false });
  });

  /** The route channel of one connection, published to as the canvas does after an edit. */
  function channelOf(initial: RoutedEdge, forward = false) {
    const channels = createRouteChannels();
    return {
      data: { channel: channels.edge('return', initial), forward, suspended: false },
      publish: (next: RoutedEdge | undefined) =>
        act(() => channels.publish(new Map(next ? [['return', next]] : []), new Set(['return']))),
    };
  }
  /**
   * The edge selected inside xyflow's edge wrapper, whose React click handler (an ancestor here)
   * selects it again, or with Control or Meta held toggles it off.
   */
  function setup(
    stand: ReturnType<typeof channelOf>,
    geometry: Partial<EdgeProps<OrthogonalFlowEdge>> = {},
    editing: ReturnType<typeof editor> = editor(),
  ) {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    const tree = (selected: boolean) => (
      <div onClick={onClick} onKeyDown={onKeyDown}>
        {inFlow(
          <OrthogonalEdge {...props} {...geometry} data={stand.data} selected={selected} />,
          editing,
        )}
      </div>
    );
    const view = render(tree(true));
    return {
      view,
      editing,
      onClick,
      onKeyDown,
      select: (selected: boolean) => view.rerender(tree(selected)),
    };
  }
  const resetButton = () => screen.getByRole('button', { name: 'Reset route' });
  const removeButton = () => screen.getByRole('button', { name: 'Remove connection' });

  it.each([
    ['a loop-back', false, automatic, {}],
    [
      'a forward connection',
      true,
      undefined,
      { sourceX: 0, sourceY: 0, targetX: 300, targetY: 120 },
    ],
  ] as const)(
    'keeps the toolbar and Reset route where they were on %s, so no later click lands on Remove connection',
    async (_, forward, after, geometry) => {
      const stand = channelOf(manual, forward);
      const { view, editing, onClick } = setup(stand, geometry);
      const user = userEvent.setup();
      const reset = resetButton();
      const remove = removeButton();
      const at = placed(view.container);
      const label = labelAt(view.container);
      expect(toolbar(view.container)).toEqual(['Reset route', 'Remove connection']);
      expect(reset).not.toHaveAttribute('aria-disabled');
      expect(reset).not.toHaveAttribute('title');

      // The first click of a double click: the browser's own sequence, then the canvas publishes.
      await user.click(reset);
      expect(editing.reset).toHaveBeenCalledTimes(1);
      expect(editing.reset).toHaveBeenCalledWith('return');
      expect(screen.getByTestId('edge')).toHaveFocus();
      stand.publish(after);

      // The route and its label moved on; the toolbar and its two controls did not.
      expect(labelAt(view.container)).not.toBe(label);
      expect(placed(view.container)).toBe(at);
      expect(resetButton()).toBe(reset);
      expect(removeButton()).toBe(remove);
      expect(reset.isConnected).toBe(true);
      expect(toolbar(view.container)).toEqual(['Reset route', 'Remove connection']);
      expect(reset).toHaveTextContent('Reset route');
      expect(reset).toHaveClass('nodrag', 'nopan', 'nokey', 'pointer-coarse:h-11');
      // Unavailable because the route is automatic: a real hit target that keeps focus and `nopan`.
      expect(reset).toBeEnabled();
      expect(reset).toHaveAttribute('aria-disabled', 'true');
      expect(reset).toHaveAttribute('title', MESSAGE);
      expect(reset).not.toHaveAttribute('data-gesture');
      expect(remove).toBeEnabled();
      expect(remove).not.toHaveAttribute('aria-disabled');

      // The second press of the double click, and any later click count, modifier or key, do nothing.
      await user.dblClick(reset);
      await user.tripleClick(reset);
      for (const detail of [2, 3, 4, 5]) fireEvent.click(reset, { detail });
      for (const modifier of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }])
        fireEvent.click(reset, modifier);
      reset.focus();
      await user.keyboard('{Enter}');
      await user.keyboard(' ');
      expect(editing.reset).toHaveBeenCalledTimes(1);
      expect(editing.remove).not.toHaveBeenCalled();
      // Each click ends on the button, as Remove connection's does: the edge wrapper never selects
      // the connection again, which with Control or Meta held would toggle it off.
      expect(onClick).not.toHaveBeenCalled();
      expect(reset).toHaveFocus();
      expect(placed(view.container)).toBe(at);
      expect(resetButton()).toBe(reset);

      // A deliberate click on Remove connection removes once.
      await user.click(remove);
      expect(editing.remove).toHaveBeenCalledTimes(1);
      expect(editing.remove).toHaveBeenCalledWith('return');
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  it('has Remove connection alone in a fresh selection of an automatic route, and forgets the hold on deselection', async () => {
    const stand = channelOf(automatic);
    const { view, select } = setup(stand);
    // A normal fresh selection: nothing to reset, nothing held, the toolbar over the label.
    expect(toolbar(view.container)).toEqual(['Remove connection']);
    expect(screen.queryByRole('button', { name: 'Reset route' })).toBeNull();
    expect(placed(view.container)).toBe(above(automatic.label));

    stand.publish(manual);
    await userEvent.setup().click(resetButton());
    stand.publish(automatic);
    expect(toolbar(view.container)).toEqual(['Reset route', 'Remove connection']);
    expect(placed(view.container)).toBe(above(manual.label));
    // Deselected, the toolbar goes; selected again it is a fresh one, as at the start.
    select(false);
    expect(view.container.querySelector('.gg-route-toolbar')).toBeNull();
    select(true);
    expect(toolbar(view.container)).toEqual(['Remove connection']);
    expect(placed(view.container)).toBe(above(automatic.label));
  });

  it.each([
    [
      'the same points array again, as an Undo might return it',
      { ...manual, label: { x: 70, y: 150 } },
    ],
    ['another manual route, as a nudge or a drag draws', nudged],
  ])('ends the hold when %s is drawn, and holds again at the next click', async (_, next) => {
    expect(next.manual).toBe(true);
    const stand = channelOf(manual);
    const { view, editing } = setup(stand);
    const user = userEvent.setup();
    await user.click(resetButton());
    stand.publish(automatic);
    expect(placed(view.container)).toBe(above(manual.label));
    expect(resetButton()).toHaveAttribute('aria-disabled', 'true');

    // The route is drawn by hand again: the toolbar follows its label and Reset route is available.
    stand.publish(next);
    expect(resetButton()).toBeEnabled();
    expect(resetButton()).not.toHaveAttribute('aria-disabled');
    expect(resetButton()).not.toHaveAttribute('title');
    expect(placed(view.container)).toBe(above(next.label));

    // It resets that route too, and holds where that was clicked.
    await user.click(resetButton());
    expect(editing.reset).toHaveBeenCalledTimes(2);
    stand.publish(automatic);
    expect(placed(view.container)).toBe(above(next.label));
    expect(resetButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('follows a different manual route that arrives before the automatic one', async () => {
    // A reset that took no effect, then the route is redrawn: nothing is held.
    const stand = channelOf(manual);
    const { view } = setup(stand);
    await userEvent.setup().click(resetButton());
    expect(placed(view.container)).toBe(above(manual.label));
    stand.publish(nudged);
    expect(placed(view.container)).toBe(above(nudged.label));
    expect(resetButton()).not.toHaveAttribute('aria-disabled');
  });

  it('keeps the width of Crosses a card as an inaccessible blank while held', async () => {
    const stand = channelOf({ ...manual, crossing: true });
    const { view, select } = setup(stand);
    const chip = screen.getByText('Crosses a card');
    const classes = chip.className.split(' ');
    expect(chip).not.toHaveAttribute('aria-hidden');
    expect(toolbar(view.container)).toEqual(['Crosses a card', 'Reset route', 'Remove connection']);

    await userEvent.setup().click(resetButton());
    stand.publish(automatic);
    // The same element with the same text and classes, so the same width, now blank and hidden
    // from assistive technology; the controls beside it do not move.
    expect(toolbar(view.container)).toEqual(['Crosses a card', 'Reset route', 'Remove connection']);
    const slot = view.container.querySelector('.gg-route-toolbar')!.children[0]!;
    expect(slot).toBe(chip);
    expect(slot).toHaveClass(...classes, 'invisible');
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    expect(placed(view.container)).toBe(above(manual.label));
    // A fresh selection of the automatic route, which crosses nothing, keeps no blank.
    select(false);
    select(true);
    expect(toolbar(view.container)).toEqual(['Remove connection']);
  });

  it('shows the note again when a crossing manual route is drawn after the hold', async () => {
    const stand = channelOf({ ...manual, crossing: true });
    const { view } = setup(stand);
    await userEvent.setup().click(resetButton());
    stand.publish(automatic);
    const slot = view.container.querySelector('.gg-route-toolbar')!.children[0]!;
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    stand.publish({ ...nudged, crossing: true });
    expect(view.container.querySelector('.gg-route-toolbar')!.children[0]).toBe(slot);
    expect(slot).not.toHaveAttribute('aria-hidden');
    expect(slot).not.toHaveClass('invisible');
  });

  it('keeps the toolbar keys on the held Reset route: Escape returns to the connection, the rest stay on the button', async () => {
    const stand = channelOf(manual);
    const { editing, onKeyDown } = setup(stand);
    await userEvent.setup().click(resetButton());
    stand.publish(automatic);
    const reset = resetButton();
    for (const key of ['Delete', 'Backspace', 'Enter', ' ']) fireEvent.keyDown(reset, { key });
    expect(onKeyDown).not.toHaveBeenCalled();
    reset.focus();
    fireEvent.keyDown(reset, { key: 'Escape' });
    expect(screen.getByTestId('edge')).toHaveFocus();
    expect(editing.reset).toHaveBeenCalledTimes(1);
    expect(editing.remove).not.toHaveBeenCalled();
  });

  it('refuses on the pan gate first, holding nothing, and keeps Reset route unavailable after a pan settles', async () => {
    const gate = createViewportGestureGate();
    const detach = gate.attach(window);
    try {
      const refused = channelOf(manual);
      const first = setup(refused, {}, editor(gate));
      act(() => gate.move(new MouseEvent('mousemove')));
      expect(resetButton()).toHaveAttribute('data-gesture', 'panning');
      fireEvent.click(resetButton());
      expect(first.editing.reset).not.toHaveBeenCalled();
      expect(first.onClick).not.toHaveBeenCalled();
      // The refused click made no hold: when the route changes some other way, the toolbar follows it.
      refused.publish(automatic);
      expect(toolbar(first.view.container)).toEqual(['Remove connection']);
      expect(placed(first.view.container)).toBe(above(automatic.label));
      first.view.unmount();
      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      });
      await waitFor(() => expect(gate.state()).toBe('ready'));

      // Held, then a pan: both controls say so; once it settles Reset route stays unavailable.
      const stand = channelOf(manual);
      const { view, editing } = setup(stand, {}, editor(gate));
      await userEvent.setup().click(resetButton());
      expect(editing.reset).toHaveBeenCalledTimes(1);
      stand.publish(automatic);
      const reset = resetButton();
      const remove = removeButton();
      expect(placed(view.container)).toBe(above(manual.label));
      act(() => gate.move(new MouseEvent('mousemove')));
      for (const button of [reset, remove]) {
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveAttribute('data-gesture', 'panning');
      }
      fireEvent.click(remove);
      expect(editing.remove).not.toHaveBeenCalled();
      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      });
      await waitFor(() => expect(remove).not.toHaveAttribute('aria-disabled'));
      expect(reset).toHaveAttribute('aria-disabled', 'true');
      expect(reset).toHaveAttribute('title', MESSAGE);
      expect(reset).not.toHaveAttribute('data-gesture');
      fireEvent.click(reset);
      expect(editing.reset).toHaveBeenCalledTimes(1);
      fireEvent.click(remove);
      expect(editing.remove).toHaveBeenCalledTimes(1);
      expect(editing.remove).toHaveBeenCalledWith('return');
    } finally {
      detach();
    }
  });

  it('keeps the store’s reason on Remove connection beside the held Reset route', async () => {
    const stand = channelOf(manual);
    const { view, editing } = setup(stand);
    await userEvent.setup().click(resetButton());
    stand.publish(automatic);
    act(() =>
      useEditorStore.setState({
        systemChat: true,
        definition: {
          schemaVersion: 4,
          name: 'Chat',
          nodes: [
            { id: 'chat-input', kind: 'trigger', label: 'In', config: { type: 'manual' } },
            { id: 'chat-normalize', kind: 'mutate', label: 'Norm', config: { operations: [] } },
          ],
          edges: [
            {
              id: 'return',
              from: { node: 'chat-input', port: 'out' },
              to: { node: 'chat-normalize' },
            },
          ],
        } as unknown as LoopDefinitionInput,
      }),
    );
    expect(removeButton()).toBeDisabled();
    expect(removeButton()).toHaveAttribute('title', VOICE_STEP_MESSAGE);
    expect(resetButton()).toHaveAttribute('aria-disabled', 'true');
    expect(resetButton()).toHaveAttribute('title', MESSAGE);
    fireEvent.click(removeButton());
    fireEvent.click(resetButton());
    expect(editing.remove).not.toHaveBeenCalled();
    expect(editing.reset).toHaveBeenCalledTimes(1);
    expect(placed(view.container)).toBe(above(manual.label));
  });
});

/**
 * Remove connection acts on a click the browser counts as 0 (Enter, Space, element.click()) or 1
 * (a separate click), and not on a later click of a double or triple click (#207): that click may
 * continue the press that selected the connection and so drew this button under the pointer. These
 * tests set the click count explicitly, since a bare `fireEvent.click` always sends 0. They drive
 * the real component and assert what it does with the count, never what a browser would count.
 */
describe('Remove connection ignores the later clicks of a double click (#207)', () => {
  const manual: RoutedEdge = { ...route, manual: true };
  /** The click counts the edge wrapper's ancestors saw, and the wrapper's own click handler. */
  function setup(routed: RoutedEdge, editing: ReturnType<typeof editor> = editor()) {
    const counts: number[] = [];
    // xyflow's edge wrapper selects its edge in a React click handler on an ancestor.
    const onClick = vi.fn();
    const view = render(
      <div onClick={onClick} onClickCapture={(event) => counts.push(event.detail)}>
        {inFlow(<OrthogonalEdge {...props} data={data(routed)} selected />, editing)}
      </div>,
    );
    return { view, editing, onClick, counts };
  }
  const removeButton = () => screen.getByRole('button', { name: 'Remove connection' });

  beforeEach(() => {
    useEditorStore.setState({ definition: undefined, systemChat: false });
  });

  it.each([
    ['an automatic route', route],
    ['a manual route', manual],
  ])(
    'removes nothing on a click counted 2 or 3 on %s, leaves the connection focused, and removes on one counted 1',
    (_, routed) => {
      const { editing, onClick, counts } = setup(routed);
      const remove = removeButton();
      const edge = screen.getByTestId('edge');
      for (const detail of [2, 3]) {
        // The second press moved focus to the button, as a browser's mousedown does.
        remove.focus();
        expect(remove).toHaveFocus();
        fireEvent.click(remove, { detail });
        expect(counts.at(-1)).toBe(detail);
        expect(editing.remove).not.toHaveBeenCalled();
        expect(editing.reset).not.toHaveBeenCalled();
        // The wrapper never sees the click, so it cannot select the connection again.
        expect(onClick).not.toHaveBeenCalled();
        // Focus returns to the connection, as after a click on its line; Remove stays available.
        expect(edge).toHaveFocus();
        expect(remove).toBeInTheDocument();
        expect(remove).toBeEnabled();
        expect(remove).not.toHaveAttribute('aria-disabled');
        expect(remove).not.toHaveAttribute('data-gesture');
      }
      // The browser's `dblclick` that follows the second click does nothing either.
      fireEvent.doubleClick(remove, { detail: 2 });
      expect(editing.remove).not.toHaveBeenCalled();
      expect(editing.reset).not.toHaveBeenCalled();

      // A separate click, counted 1, removes once.
      fireEvent.click(remove, { detail: 1 });
      expect(editing.remove).toHaveBeenCalledTimes(1);
      expect(editing.remove).toHaveBeenCalledWith('return');
      expect(editing.reset).not.toHaveBeenCalled();
      expect(onClick).not.toHaveBeenCalled();
    },
  );

  it('ends a refused click on the button for every modifier, so Control or Meta cannot select the connection again', () => {
    const { editing, onClick } = setup(route);
    const remove = removeButton();
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, {}]) {
      for (const detail of [2, 3]) fireEvent.click(remove, { detail, ...modifier });
    }
    expect(onClick).not.toHaveBeenCalled();
    expect(editing.remove).not.toHaveBeenCalled();
    // An accepted click ends on the button the same way.
    fireEvent.click(remove, { detail: 1, ctrlKey: true });
    expect(editing.remove).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('still removes on Enter, on Space and on element.click(), which the browser counts 0', async () => {
    const { editing, counts } = setup(route);
    const remove = removeButton();
    const user = userEvent.setup();
    remove.focus();
    await user.keyboard('{Enter}');
    expect(counts).toEqual([0]);
    expect(editing.remove).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(counts).toEqual([0, 0]);
    expect(editing.remove).toHaveBeenCalledTimes(2);
    remove.click();
    expect(counts).toEqual([0, 0, 0]);
    expect(editing.remove).toHaveBeenCalledTimes(3);
    // A pointer click through user-event is counted 1.
    await user.click(remove);
    expect(counts).toEqual([0, 0, 0, 1]);
    expect(editing.remove).toHaveBeenCalledTimes(4);
    expect(editing.remove).toHaveBeenLastCalledWith('return');
  });

  it('keeps refusing a click counted 1 while a pan settles, and a later click counted 2 once it is ready', async () => {
    const gate = createViewportGestureGate();
    const detach = gate.attach(window);
    try {
      const { editing } = setup(route, editor(gate));
      const remove = removeButton();
      const edge = screen.getByTestId('edge');
      act(() => gate.move(new MouseEvent('mousemove')));
      expect(remove).toHaveAttribute('data-gesture', 'panning');
      // The existing refusal: nothing is removed, and focus stays where it was.
      remove.focus();
      fireEvent.click(remove, { detail: 1 });
      expect(editing.remove).not.toHaveBeenCalled();
      expect(remove).toHaveFocus();
      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      });
      await waitFor(() => expect(remove).not.toHaveAttribute('aria-disabled'));
      // Ready: a click counted 2 is refused and returns focus to the connection; a click counted 1
      // removes.
      remove.focus();
      fireEvent.click(remove, { detail: 2 });
      expect(editing.remove).not.toHaveBeenCalled();
      expect(edge).toHaveFocus();
      fireEvent.click(remove, { detail: 1 });
      expect(editing.remove).toHaveBeenCalledTimes(1);
      expect(editing.remove).toHaveBeenCalledWith('return');
    } finally {
      detach();
    }
  });

  it('leaves the store’s own refusal alone: a protected connection stays disabled with its reason', () => {
    useEditorStore.setState({
      systemChat: true,
      definition: {
        schemaVersion: 4,
        name: 'Chat',
        nodes: [
          { id: 'chat-input', kind: 'trigger', label: 'In', config: { type: 'manual' } },
          { id: 'chat-normalize', kind: 'mutate', label: 'Norm', config: { operations: [] } },
        ],
        edges: [
          {
            id: 'return',
            from: { node: 'chat-input', port: 'out' },
            to: { node: 'chat-normalize' },
          },
        ],
      } as unknown as LoopDefinitionInput,
    });
    try {
      const { editing } = setup(route);
      const remove = removeButton();
      for (const detail of [0, 1, 2, 3]) fireEvent.click(remove, { detail });
      expect(remove).toBeDisabled();
      expect(remove).toHaveAttribute('title', VOICE_STEP_MESSAGE);
      expect(editing.remove).not.toHaveBeenCalled();
    } finally {
      useEditorStore.setState({ definition: undefined, systemChat: false });
    }
  });
});

describe('notePlacement (#481)', () => {
  const pane = { width: 1000, height: 800 };
  it('centres the note above the controls at the toolbar width while it has room, or before the pane is measured', () => {
    expect(notePlacement({ x: 500, y: 600 }, [0, 0, 1], pane)).toEqual({
      width: 420,
      shift: 0,
      below: false,
    });
    expect(notePlacement({ x: 0, y: 0 }, [0, 0, 1], { width: 0, height: 0 })).toEqual({
      width: 420,
      shift: 0,
      below: false,
    });
  });

  it('reads the anchor through the viewport transform', () => {
    // (100, 400) at zoom 2, panned by (20, -300), is (220, 500) in the pane: 220 - 210 leaves
    // 10 px, over the 8 px margin, and 500 - 74 = 426 px above holds the note.
    expect(notePlacement({ x: 100, y: 400 }, [20, -300, 2], pane)).toEqual({
      width: 420,
      shift: 0,
      below: false,
    });
    // (90, 400) is 200 px across: 18 px right reaches the margin.
    expect(notePlacement({ x: 90, y: 400 }, [20, -300, 2], pane).shift).toBe(18);
    // Panned 300 px further up, the label is 200 px down: 126 px above, 582 px below.
    expect(notePlacement({ x: 100, y: 400 }, [20, -600, 2], pane).below).toBe(true);
  });

  it('narrows to the pane less its margins and moves inside it, by at most half its width', () => {
    const narrow = { width: 390, height: 800 };
    expect(notePlacement({ x: 195, y: 600 }, [0, 0, 1], narrow)).toEqual({
      width: 374,
      shift: 0,
      below: false,
    });
    expect(notePlacement({ x: 350, y: 600 }, [0, 0, 1], narrow).shift).toBe(-155);
    expect(notePlacement({ x: 40, y: 600 }, [0, 0, 1], narrow).shift).toBe(155);
    // A label beyond the pane's side: the note still covers it, at its edge.
    expect(notePlacement({ x: -100, y: 600 }, [0, 0, 1], narrow).shift).toBe(187);
    expect(notePlacement({ x: 600, y: 600 }, [0, 0, 1], narrow).shift).toBe(-187);
  });

  it('goes below the label when the room above the controls is less than the note’s and there is more below', () => {
    // 314 - 18 - 48 - 8 = 240 px above: the note's whole room.
    expect(notePlacement({ x: 500, y: 314 }, [0, 0, 1], pane).below).toBe(false);
    // 239 px above, and 800 - 313 - 18 = 469 px below.
    expect(notePlacement({ x: 500, y: 313 }, [0, 0, 1], pane).below).toBe(true);
    // Room for neither: the larger side, here above (126 px over 82 px).
    expect(notePlacement({ x: 500, y: 200 }, [0, 0, 1], { width: 1000, height: 300 }).below).toBe(
      false,
    );
  });
});
