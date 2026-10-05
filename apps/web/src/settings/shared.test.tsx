import { GraphGoblinApiError, modelCatalog } from '@graphgoblin/api-client';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { useApi } from '../api/context.js';
import { CATALOG_MESSAGES } from './sections/ModelCatalogSection.js';
import { EnableSwitch, MutationError } from './shared.js';

describe('MutationError', () => {
  it('uses caller messages, otherwise preserves the normal error display', () => {
    const error = new GraphGoblinApiError({ status: 409, code: 'MODEL_MANAGED_BY_HARNESS' });
    const { rerender } = renderWith(<MutationError error={error} announce />);
    expect(screen.getByRole('alert')).toHaveTextContent('MODEL_MANAGED_BY_HARNESS');
    rerender(
      <MutationError
        error={error}
        messages={{ MODEL_MANAGED_BY_HARNESS: 'Managed elsewhere.' }}
        announce
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Managed elsewhere.');
    rerender(
      <MutationError error={new Error('Failed to save.')} messages={CATALOG_MESSAGES} announce />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save.');
    rerender(<MutationError error={null} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('EnableSwitch', () => {
  it.each([
    ['MODEL_MANAGED_BY_HARNESS', 409],
    ['LITELLM_NOT_CONFIGURED', 409],
    ['MODEL_NOT_FOUND', 404],
  ] as const)(
    'checks the generic %s message mapping, pending state, rollback and retry',
    async (code, status) => {
      let finish!: () => void;
      const held = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const onToggle = vi.fn<() => Promise<void>>(async () => {
        await held;
        throw new GraphGoblinApiError({ status, code });
      });
      function Example() {
        const [enabled, setEnabled] = useState(true);
        return (
          <EnableSwitch
            name="Example"
            enabled={enabled}
            onToggle={async (next) => {
              await onToggle();
              setEnabled(next);
            }}
            messages={CATALOG_MESSAGES}
          />
        );
      }
      renderWith(<Example />);
      const user = userEvent.setup();
      const toggle = screen.getByRole('switch', { name: 'Enable Example' });
      await user.click(toggle);
      expect(toggle).not.toBeChecked();
      expect(toggle).not.toBeDisabled();
      expect(toggle).toHaveAttribute('aria-disabled', 'true');
      expect(toggle).toHaveAttribute('aria-busy', 'true');
      expect(toggle).toHaveFocus();
      expect(within(toggle.parentElement!).getByRole('status')).toHaveTextContent(
        'Example: Disabling…',
      );
      await user.keyboard(' {Enter}');
      expect(onToggle).toHaveBeenCalledTimes(1);
      await act(() => Promise.resolve(finish()));
      const message = CATALOG_MESSAGES[code]!;
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(toggle).toBeChecked();
      expect(toggle).toHaveAttribute('aria-disabled', 'false');
      expect(toggle).toHaveAttribute('aria-busy', 'false');
      expect(toggle).toHaveAccessibleDescription(`Example: Enabled ${message}`);
      expect(toggle).toHaveFocus();
      onToggle.mockImplementation(() => Promise.resolve());
      await user.click(toggle);
      await waitFor(() => expect(toggle).toHaveAttribute('aria-busy', 'false'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(within(toggle.parentElement!).getByRole('status')).toHaveTextContent(
        'Example: Disabled',
      );
    },
  );

  it('blocks a second activation before the pending render', async () => {
    let finish!: () => void;
    const onToggle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderWith(<EnableSwitch name="Example" enabled onToggle={onToggle} />);
    const toggle = screen.getByRole('switch');
    act(() => {
      fireEvent.click(toggle);
      fireEvent.click(toggle);
    });
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve(finish()));
  });

  it.each(['first', 'second'] as const)(
    'keeps focus on the second switch when the %s held PATCH finishes first',
    async (firstToFinish) => {
      const api = new FakeApi();
      api.catalog = ['first', 'second'].map((model) => ({
        harness: 'codex',
        model,
        source: 'harness',
        displayName: model,
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: true,
      }));
      const finish = new Map<string, () => void>();
      api.override(
        'PATCH /model-catalog/:harness/:model',
        (call, params) =>
          new Promise<Response>((resolve) => {
            finish.set(params[1]!, () => {
              void Promise.resolve(api.builtIn(call)).then(resolve);
            });
          }),
      );
      function Row({ name }: { name: string }) {
        const client = useApi();
        const [enabled, setEnabled] = useState(true);
        return (
          <EnableSwitch
            name={name}
            enabled={enabled}
            onToggle={async (next) => {
              const result = await modelCatalog.setEnabled(client, 'codex', name, next);
              setEnabled(result.enabled);
            }}
          />
        );
      }
      renderWith(
        <>
          <Row name="first" />
          <Row name="second" />
        </>,
        '/',
        api,
      );
      const user = userEvent.setup();
      const first = screen.getByRole('switch', { name: 'Enable first' });
      const second = screen.getByRole('switch', { name: 'Enable second' });
      await user.tab();
      expect(first).toHaveFocus();
      await user.keyboard(' ');
      await user.tab();
      expect(second).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(first).toHaveAttribute('aria-busy', 'true');
      expect(second).toHaveAttribute('aria-busy', 'true');
      const a = firstToFinish === 'first' ? first : second;
      const b = a === first ? second : first;
      await act(() => Promise.resolve(finish.get(firstToFinish)!()));
      await waitFor(() => expect(a).toHaveAttribute('aria-busy', 'false'));
      expect(second).toHaveFocus();
      expect(b).toHaveAttribute('aria-busy', 'true');
      await act(() =>
        Promise.resolve(finish.get(firstToFinish === 'first' ? 'second' : 'first')!()),
      );
      await waitFor(() => expect(b).toHaveAttribute('aria-busy', 'false'));
      expect(second).toHaveFocus();
      expect(first).not.toBeChecked();
      expect(second).not.toBeChecked();
      expect(api.callsTo('PATCH', '/model-catalog/codex/first')[0]?.body).toEqual({
        enabled: false,
      });
      expect(api.callsTo('PATCH', '/model-catalog/codex/second')[0]?.body).toEqual({
        enabled: false,
      });
    },
  );
});
