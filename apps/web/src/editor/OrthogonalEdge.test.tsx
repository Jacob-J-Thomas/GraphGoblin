import { act, fireEvent, render, screen } from '@testing-library/react';
import { getSmoothStepPath, Position, ReactFlowProvider, type EdgeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { OrthogonalEdge, type OrthogonalFlowEdge } from './OrthogonalEdge.js';
import { RouteEditingContext, type RouteEditing } from './route-editing.js';
import type { RoutedEdge } from './routing.js';
import { createRouteChannels } from './route-channels.js';

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

const editor = () => ({
  begin: vi.fn<RouteEditing['begin']>(),
  nudge: vi.fn<RouteEditing['nudge']>(() => undefined),
  reset: vi.fn<RouteEditing['reset']>(),
});

describe('OrthogonalEdge', () => {
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
});
