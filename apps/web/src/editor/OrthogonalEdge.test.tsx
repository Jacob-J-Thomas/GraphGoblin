import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSmoothStepPath, Position, ReactFlowProvider, type EdgeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { OrthogonalEdge, type OrthogonalFlowEdge } from './OrthogonalEdge.js';
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
    'disables Remove connection for an id two stored connections hold, saying so, in %s (#207)',
    (_, system, voiceFirst) => {
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
        'More than one connection uses the ID "return"; this action cannot choose just one.';
      const gate = createViewportGestureGate();
      const editing = editor(gate);
      try {
        render(inFlow(<OrthogonalEdge {...props} selected />, editing));
        const remove = screen.getByRole('button', { name: 'Remove connection' });
        expect(remove).toBeDisabled();
        expect(remove).toHaveAttribute('title', message);
        fireEvent.click(remove);
        expect(editing.remove).not.toHaveBeenCalled();
        // The store's reason outranks a pan in progress, as the voice step's does.
        act(() => gate.move(new MouseEvent('mousemove')));
        expect(remove).toBeDisabled();
        expect(remove).toHaveAttribute('title', message);
        expect(remove).not.toHaveAttribute('aria-disabled');
        expect(remove).not.toHaveAttribute('data-gesture');
        // One holder again: an ordinary connection may go; the voice step keeps its own reason.
        act(() => useEditorStore.setState({ definition: { ...definition, edges: [plain] } }));
        expect(remove).toBeEnabled();
        expect(remove).not.toHaveAttribute('title');
        act(() => useEditorStore.setState({ definition: { ...definition, edges: [voice] } }));
        expect(remove.getAttribute('title')).toBe(system ? VOICE_STEP_MESSAGE : null);
      } finally {
        useEditorStore.setState({ definition: undefined, systemChat: false });
      }
    },
  );

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
