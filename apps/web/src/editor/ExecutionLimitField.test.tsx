import { GATE_FIELD_OVERRIDES } from './DecisionGateFields.js';
import userEvent from '@testing-library/user-event';
import { runRecord } from '../__fixtures__/fake-api.js';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExecutionLimitsSchema, ExpressionDecisionConfigSchema } from '@graphgoblin/contracts';
import { renderWith } from '../__fixtures__/render.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { ExecutionLimitField } from './ExecutionLimitField.js';
import { ExecutionDefaultsSection } from '../settings/sections/ExecutionDefaultsSection.js';
import { RunLimits } from '../runs/inspector/RunLimits.js';
import { samplePin } from '@graphgoblin/contracts/testing';

describe('execution limit presentation', () => {
  it('shows defaults and persists an explicit unlimited choice with a warning', async () => {
    const changes: unknown[] = [];
    const user = userEvent.setup();
    renderWith(
      <SchemaForm
        label="Execution limits form"
        schema={ExecutionLimitsSchema}
        value={{}}
        controls={{ 'execution-limit': ExecutionLimitField }}
        onChange={(value) => changes.push(value)}
      />,
    );
    expect(screen.getByRole('spinbutton', { name: 'Max node visits' })).toHaveValue(10);
    expect(screen.queryByRole('spinbutton', { name: 'Run deadline seconds' })).toBeNull();
    expect(screen.getByText(/No deadline; set one/)).toBeVisible();
    expect(screen.queryByText(/will not stop execution/)).toBeNull();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Run deadline seconds mode' }),
      'limited',
    );
    expect(screen.getByRole('spinbutton', { name: 'Run deadline seconds' })).toHaveValue(3600);
    expect(changes.at(-1)).toMatchObject({ runDeadlineSeconds: 3600 });
    const deadline = screen.getByRole('spinbutton', { name: 'Run deadline seconds' });
    await user.clear(deadline);
    expect(screen.getByRole('spinbutton', { name: 'Run deadline seconds' })).toBe(deadline);
    await user.type(deadline, '5');
    expect(deadline).toHaveValue(5);
    expect(changes.at(-1)).toMatchObject({ runDeadlineSeconds: 5 });

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Run deadline seconds mode' }),
      'unlimited',
    );
    expect(changes.at(-1)).toMatchObject({ runDeadlineSeconds: null });
    expect(screen.queryByText(/will not stop execution/)).toBeNull();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Max node visits mode' }),
      'unlimited',
    );
    expect(screen.getByText(/this guardrail will not stop execution/)).toBeVisible();
    expect(changes.at(-1)).toMatchObject({ maxNodeVisits: null });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Max node visits mode' }),
      'limited',
    );
    expect(changes.at(-1)).toMatchObject({ maxNodeVisits: 10 });
  });
  it('replaces a visible default by typing and holds invalid numbers until corrected', async () => {
    const changes: unknown[] = [];
    const user = userEvent.setup();
    renderWith(
      <SchemaForm
        label="Execution limits"
        schema={ExecutionLimitsSchema}
        value={{}}
        controls={{ 'execution-limit': ExecutionLimitField }}
        onChange={(value) => changes.push(value)}
      />,
    );
    const visits = screen.getByRole('spinbutton', { name: 'Max node visits' });
    await user.clear(visits);
    await user.type(visits, '4');
    expect(visits).toHaveValue(4);
    expect(changes.at(-1)).toMatchObject({ maxNodeVisits: 4 });
    await user.clear(visits);
    await user.type(visits, '0');
    expect(screen.getByRole('alert')).toBeVisible();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Max node visits mode' }),
      'unlimited',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(changes.at(-1)).toMatchObject({ maxNodeVisits: null });
  });

  it('uses the explicit unlimited control inside the decision gate override', async () => {
    const changes: unknown[] = [];
    const user = userEvent.setup();
    renderWith(
      <SchemaForm
        label="Gate limits"
        schema={ExpressionDecisionConfigSchema}
        fieldOverrides={GATE_FIELD_OVERRIDES}
        value={{
          kind: 'expression',
          jsonata: '"again"',
          maxPasses: null,
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'done', label: 'Done' },
          ],
        }}
        onChange={(value) => changes.push(value)}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Max passes mode' })).toHaveValue('unlimited');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Max passes mode' }), 'limited');
    expect(screen.getByRole('spinbutton', { name: 'Max passes' })).toHaveAttribute(
      'aria-required',
      'true',
    );
    expect(changes.at(-1)).toMatchObject({ maxPasses: 10 });
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Max passes mode' }),
      'unlimited',
    );
    expect(changes.at(-1)).toMatchObject({ maxPasses: null });
  });

  it('shows contract defaults in Settings before any run', () => {
    renderWith(<ExecutionDefaultsSection />);
    expect(screen.getByText(/Maximum node visits: 10/)).toHaveTextContent(
      'No run deadline unless the loop sets one.',
    );
  });
  it('shows the actual pinned limits and deadline in the inspector', () => {
    renderWith(
      <RunLimits
        run={runRecord({
          startedAt: '2026-10-21T12:00:00.000Z',
          pinned: samplePin({ limits: { maxNodeVisits: null, runDeadlineSeconds: 2 } }),
        })}
      />,
    );
    expect(screen.getByText(/Maximum node visits: Unlimited/)).toHaveTextContent(
      'Run deadline: 2 seconds',
    );
    expect(screen.getByText(/Deadline at:/)).toHaveTextContent('2026-10-21T12:00:02.000Z');
  });
  it('shows a disabled deadline truthfully', () => {
    renderWith(
      <RunLimits
        run={runRecord({
          pinned: samplePin({ limits: { maxNodeVisits: 3, runDeadlineSeconds: null } }),
        })}
      />,
    );
    expect(screen.getByText(/Maximum node visits: 3/)).toHaveTextContent('Run deadline: none');
    expect(screen.queryByText(/Deadline at:/)).toBeNull();
  });
});
