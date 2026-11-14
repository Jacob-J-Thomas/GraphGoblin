import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { VOICE_STEP_MESSAGE } from './chat-protection.js';
import { fieldErrorIssues, validateDraft, type EditorIssue } from './model.js';
import { useEditorStore } from './store.js';
import { ValidationIndicator } from './ValidationIndicator.js';

const definition = kitchenSinkLoop();
const loopLevel: EditorIssue = { code: 'NO_EXIT', severity: 'error', message: 'needs an exit' };
const edge: EditorIssue = {
  code: 'DUPLICATE_EDGE_ID',
  severity: 'warning',
  message: 'edge id "e1" is used twice',
  edgeId: 'e1',
};
const onPrep: EditorIssue = {
  code: 'PORT_UNCONNECTED',
  severity: 'error',
  message: 'port "out" of "prep" is not connected',
  nodeId: 'prep',
};
const onInfer: EditorIssue = {
  code: 'GATE_PASSES_ABOVE_VISIT_CAP',
  severity: 'warning',
  message: 'above the visit cap',
  nodeId: 'infer',
};

describe('ValidationIndicator', () => {
  beforeEach(() => useEditorStore.getState().load('L1', definition));

  it('says "Ready to publish" as a status, not a button, when there is nothing to fix', () => {
    render(<ValidationIndicator issues={[]} definition={definition} />);
    const ready = screen.getByText('Ready to publish');
    expect(ready.querySelector('[data-icon="check-circle"]')).not.toBeNull();
    expect(ready).toHaveClass('text-status-good-fg');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says "Ready to publish" only once the server check is done; until then, or if it fails, says so', () => {
    const { rerender } = render(
      <ValidationIndicator issues={[]} definition={definition} check="pending" />,
    );
    expect(screen.getByText('Checking…')).toHaveClass('text-muted');
    expect(screen.queryByText('Ready to publish')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<ValidationIndicator issues={[]} definition={definition} check="error" />);
    const unavailable = screen.getByText('Validation unavailable');
    expect(unavailable).toHaveClass('text-muted');
    expect(unavailable).not.toHaveClass('text-status-bad-fg');
    expect(unavailable).toHaveAttribute('title', expect.stringMatching(/server/));
    expect(screen.queryByText('Ready to publish')).toBeNull();
    rerender(<ValidationIndicator issues={[]} definition={definition} check="done" />);
    expect(screen.getByText('Ready to publish')).toHaveClass('text-status-good-fg');
    // With issues the counts show whatever the server check is doing.
    rerender(<ValidationIndicator issues={[onPrep]} definition={definition} check="pending" />);
    expect(screen.getByRole('button', { name: '1 error' })).toBeInTheDocument();
    rerender(<ValidationIndicator issues={[onPrep]} definition={definition} check="error" />);
    expect(screen.getByRole('button', { name: '1 error' })).toBeInTheDocument();
  });

  it('is a button named by the counts, toned by the worst severity', () => {
    const { rerender } = render(
      <ValidationIndicator issues={[loopLevel, onPrep, edge]} definition={definition} />,
    );
    const button = screen.getByRole('button', { name: '2 errors, 1 warning' });
    expect(button).toHaveAttribute('data-severity', 'error');
    expect(button.querySelector('svg')).toHaveAttribute('data-icon', 'failed');
    rerender(<ValidationIndicator issues={[edge]} definition={definition} />);
    const warnings = screen.getByRole('button', { name: '1 warning' });
    expect(warnings).toHaveAttribute('data-severity', 'warning');
    expect(warnings.querySelector('svg')).toHaveAttribute('data-icon', 'alert');
    rerender(<ValidationIndicator issues={[onPrep]} definition={definition} />);
    expect(screen.getByRole('button', { name: '1 error' })).toBeInTheDocument();
  });

  it('lists loop-level and edge issues in full, then one row per node that opens it', async () => {
    const user = userEvent.setup();
    const orphan: EditorIssue = { ...onPrep, nodeId: 'gone', message: 'about a renamed node' };
    render(
      <ValidationIndicator
        issues={[loopLevel, onPrep, edge, onInfer, { ...onPrep, message: 'second' }, orphan]}
        definition={definition}
      />,
    );
    await user.click(screen.getByRole('button', { name: '4 errors, 2 warnings' }));
    const popover = screen.getByRole('dialog', { name: 'Loop issues' });
    const general = within(popover).getByRole('group', { name: 'Loop and connections' });
    const generalRows = within(general).getAllByRole('listitem');
    expect(generalRows).toHaveLength(3);
    expect(generalRows[0]).toHaveTextContent(/Error\s*NO_EXIT\s*needs an exit/);
    expect(generalRows[1]).toHaveTextContent('edge e1');
    expect(generalRows[1]).toHaveTextContent('Warning');
    // An issue about a node that is gone stays visible here, so the counts add up.
    expect(generalRows[2]).toHaveTextContent('node gone');
    expect(within(general).queryAllByRole('button')).toHaveLength(0);

    // Nodes in the definition's order, each with its count and worst severity.
    const nodes = within(popover).getByRole('group', { name: 'Nodes' });
    const rows = within(nodes).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual(['prep: 2 issues', 'infer: 1 issue']);
    expect(rows[0]!.querySelector('[data-icon="failed"]')).not.toBeNull();
    expect(rows[1]!.querySelector('[data-icon="alert"]')).not.toBeNull();
    await user.click(rows[1]!);
    expect(screen.queryByRole('dialog', { name: 'Loop issues' })).toBeNull();
    expect(useEditorStore.getState()).toMatchObject({
      selectedNodeId: 'infer',
      nodeDialogOpen: true,
      nodeFocus: undefined,
    });
  });

  it('shows only the groups that have issues', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ValidationIndicator issues={[onPrep]} definition={definition} />);
    await user.click(screen.getByRole('button', { name: '1 error' }));
    expect(screen.queryByRole('group', { name: 'Loop and connections' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Nodes' })).toBeInTheDocument();
    rerender(<ValidationIndicator issues={[loopLevel]} definition={definition} />);
    expect(screen.getByRole('group', { name: 'Loop and connections' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Nodes' })).toBeNull();
  });

  it('removes an edge the canvas cannot draw from its issue row, once, then returns focus (#207)', async () => {
    const user = userEvent.setup();
    const stranded = kitchenSinkLoop();
    stranded.edges.push({
      id: 'ghost',
      from: { node: 'prep', port: 'nope' },
      to: { node: 'gone' },
    });
    useEditorStore.getState().load('L1', stranded);
    function Live() {
      const def = useEditorStore((s) => s.definition)!;
      return <ValidationIndicator issues={validateDraft(def).issues} definition={def} />;
    }
    render(<Live />);
    const before = useEditorStore.getState().definition!;
    await user.click(screen.getByRole('button', { name: /error/ }));
    const general = screen.getByRole('group', { name: 'Loop and connections' });
    // Two issues name the edge; one action. Drawable edges' rows have none.
    expect(within(general).getAllByText(/edge "ghost"/)).toHaveLength(2);
    const remove = within(general).getAllByRole('button', { name: /^Remove edge/ });
    expect(remove.map((b) => b.textContent)).toEqual(['Remove edge ghost']);
    await user.click(remove[0]!);
    const after = useEditorStore.getState().definition!;
    expect(after.edges).toEqual(before.edges.filter((e) => e.id !== 'ghost'));
    expect(after.nodes).toBe(before.nodes);
    expect(useEditorStore.getState().past.map((step) => step.label)).toEqual([
      'remove edge prep nope to gone',
    ]);
    expect(screen.queryByRole('dialog', { name: 'Loop issues' })).toBeNull();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().definition!.edges).toEqual(before.edges);
  });

  it('keeps a protected Chat voice step that the canvas cannot draw, saying why (#207)', async () => {
    const user = userEvent.setup();
    const chat = {
      schemaVersion: 4,
      name: 'Chat',
      nodes: [
        { id: 'chat-input', kind: 'trigger', label: 'In', config: { type: 'manual' } },
        { id: 'chat-normalize', kind: 'mutate', label: 'N', config: { operations: [] } },
      ],
      edges: [{ id: 'v1', from: { node: 'chat-normalize', port: 'out' }, to: { node: 'gone' } }],
    } as unknown as LoopDefinitionInput;
    useEditorStore.getState().load('L1', chat);
    useEditorStore.setState({ systemChat: true });
    const issue: EditorIssue = {
      code: 'EDGE_TO_MISSING',
      severity: 'error',
      message: 'x',
      edgeId: 'v1',
    };
    render(<ValidationIndicator issues={[issue]} definition={chat} />);
    await user.click(screen.getByRole('button', { name: '1 error' }));
    const remove = screen.getByRole('button', { name: 'Remove edge v1' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', VOICE_STEP_MESSAGE);
    useEditorStore.setState({ systemChat: false });
  });

  it('discards loop-level unparsed text, leaving focus on "Ready to publish"', async () => {
    const user = userEvent.setup();
    useEditorStore.getState().setFieldError('settings', 'defaults', { message: 'bad', text: '{' });
    function Live() {
      const fieldErrors = useEditorStore((s) => s.fieldErrors);
      return <ValidationIndicator issues={fieldErrorIssues(fieldErrors)} definition={definition} />;
    }
    render(<Live />);
    await user.click(screen.getByRole('button', { name: '1 error' }));
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('FIELD_INPUT_INVALID');
    expect(within(row).getByText('settings.defaults').tagName).toBe('CODE');
    await user.click(
      within(row).getByRole('button', { name: 'Discard the unparsed text at defaults' }),
    );
    expect(useEditorStore.getState().fieldErrors).toEqual({});
    await waitFor(() => expect(screen.getByText('Ready to publish')).toHaveFocus());
  });
});
