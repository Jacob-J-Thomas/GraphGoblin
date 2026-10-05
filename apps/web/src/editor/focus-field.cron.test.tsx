import { NodeConfigSchemas } from '@graphgoblin/contracts';
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWith } from '../__fixtures__/render.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';
import { focusIssuePath } from './focus-field.js';

describe('cron issue paths in the node editor', () => {
  it.each([
    ['config.expression', 'Cron expression'],
    ['config.timezone', 'Timezone'],
  ])('%s focuses its control and reveals the expression when needed', (path, label) => {
    const { container } = renderWith(
      <div data-field-scope="config">
        <SchemaForm
          schema={NodeConfigSchemas.trigger}
          value={{ subtype: 'cron', expression: '0 9 * * *', timezone: 'UTC' }}
          label="Trigger config"
          controls={NODE_FIELD_CONTROLS}
          onChange={() => undefined}
        />
      </div>,
    );
    const raw = screen.getByLabelText('Cron expression');
    expect(raw).not.toBeVisible();
    act(() => expect(focusIssuePath(container, path)).toBe(true));
    expect(screen.getByLabelText(label)).toHaveFocus();
    expect(screen.getByLabelText(label)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Advanced Cron expression' })).toHaveAttribute(
      'aria-expanded',
      path === 'config.expression' ? 'true' : 'false',
    );
  });
});
