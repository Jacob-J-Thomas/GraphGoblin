import { kitchenSinkLoop } from '@graphgoblin/contracts/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fieldErrorIssues, type EditorIssue } from './model.js';
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
  code: 'CRITERION_ABOVE_CEILING',
  severity: 'warning',
  message: 'above the ceiling',
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
    expect(row).toHaveTextContent('FIELD_UNPARSED');
    expect(within(row).getByText('settings.defaults').tagName).toBe('CODE');
    await user.click(
      within(row).getByRole('button', { name: 'Discard unparsed text at defaults' }),
    );
    expect(useEditorStore.getState().fieldErrors).toEqual({});
    await waitFor(() => expect(screen.getByText('Ready to publish')).toHaveFocus());
  });
});
