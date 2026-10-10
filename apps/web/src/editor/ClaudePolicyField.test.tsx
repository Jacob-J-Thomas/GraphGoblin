import { InferenceConfigSchema, type ClaudePolicy } from '@graphgoblin/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';

const readOnly: ClaudePolicy = {
  sandbox: 'read-only',
  approval: 'never',
  permissionMode: 'dontAsk',
  tools: ['Read'],
  authMethod: 'claude.ai',
  boundary: 'builtin-tools',
  network: 'unconfined',
};
const fullAccess: ClaudePolicy = {
  ...readOnly,
  sandbox: 'danger-full-access',
  tools: [],
  boundary: 'unconfined',
};
const schema = z.object({
  harness: InferenceConfigSchema.shape.harness,
  harnessOptions: InferenceConfigSchema.shape.harnessOptions,
});
const policy = () => screen.getByLabelText('Sandbox and approval policy');

function renderPolicy(api: FakeApi, sandbox = 'read-only') {
  const change = vi.fn();
  renderWith(
    <SchemaForm
      schema={schema}
      value={{ harness: 'claude', harnessOptions: { sandbox, approval: 'never' } }}
      label="Inference"
      onChange={change}
      controls={NODE_FIELD_CONTROLS}
    />,
    '/',
    api,
  );
  return change;
}

describe('Claude saved policy readiness', () => {
  it.each(['pending', 'failed', 'not-ready', 'signed-out'] as const)(
    'preserves the saved pair as unverified and read-only when readiness is %s',
    async (state) => {
      const api = new FakeApi();
      api.preflight = [
        {
          harness: 'claude',
          ok: state !== 'not-ready',
          authenticated: state !== 'signed-out',
          problems: [],
          supportedPolicies: [readOnly, fullAccess],
        },
      ];
      if (state === 'pending')
        api.override('GET /harness/preflight', () => new Promise<Response>(() => undefined));
      if (state === 'failed')
        api.override('GET /harness/preflight', () =>
          problem(503, 'FAILED', 'preflight unavailable'),
        );
      const change = renderPolicy(api);
      await waitFor(() =>
        expect(
          within(policy()).getByRole('option', { name: /read-only.*never.*saved; not verified/ }),
        ).toBeInTheDocument(),
      );
      expect(policy()).toHaveAttribute('aria-readonly', 'true');
      expect(policy()).not.toHaveTextContent(/unsupported/);
      fireEvent.change(policy(), { target: { value: '1' } });
      expect(change).not.toHaveBeenCalled();
      expect(policy()).toHaveValue('unsupported');
      expect(
        within(policy()).getByRole('option', { name: /read-only.*never/ }),
      ).toBeInTheDocument();
    },
  );

  it.each(['read-only', 'workspace-write'])(
    'keeps saved %s policy unchanged until an explicit verified choice',
    async (sandbox) => {
      const api = new FakeApi();
      api.preflight = [
        {
          harness: 'claude',
          ok: true,
          authenticated: true,
          problems: [],
          supportedPolicies: [readOnly, fullAccess],
        },
      ];
      const change = renderPolicy(api, sandbox);
      await waitFor(() => expect(policy()).not.toHaveAttribute('aria-readonly'));
      if (sandbox === 'workspace-write') expect(policy()).toHaveTextContent(/unsupported; saved/);
      else expect(policy()).not.toHaveTextContent(/not verified|unsupported/);
      expect(change).not.toHaveBeenCalled();
      await userEvent.setup().selectOptions(policy(), '1');
      expect(change).toHaveBeenLastCalledWith(
        expect.objectContaining({
          harnessOptions: expect.objectContaining({
            sandbox: 'danger-full-access',
            approval: 'never',
          }),
        }),
        expect.objectContaining({ path: 'harnessOptions.sandbox', kind: 'commit' }),
      );
    },
  );
});
