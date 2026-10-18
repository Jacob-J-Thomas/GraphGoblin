import { TriggerConfigSchema } from '@graphgoblin/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { manualTriggerConfig } from '../__fixtures__/triggers.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { TriggerTypePicker } from './TriggerTypePicker.js';

describe('TriggerTypePicker', () => {
  it('uses type and signing literals when every schema title is changed to the same text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema = z.union(
      TriggerConfigSchema.options.map((option) => option.meta({ title: 'Renamed config' })),
    );
    render(
      <SchemaForm
        schema={schema}
        label="Trigger config"
        value={manualTriggerConfig()}
        onChange={onChange}
        unionPickers={{ '': TriggerTypePicker }}
      />,
    );
    const type = screen.getByLabelText('Trigger type');
    for (const triggerType of ['cron', 'poll', 'event', 'webhook']) {
      await user.selectOptions(type, triggerType);
      expect(onChange.mock.lastCall?.[0]).toMatchObject({ type: triggerType });
    }
    expect(screen.queryByLabelText('Signing protocol')).not.toBeInTheDocument();
    await user.selectOptions(type, 'manual');
    expect(type).toHaveDisplayValue('Manual');
  });
});
