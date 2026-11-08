import { field } from '@graphgoblin/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HelpText, Label, Select } from '../components/ui/index.js';
import type { UnionPicker, UnionPickerProps } from './fields.js';
import { SchemaForm } from './SchemaForm.js';

const schema = z.object({
  mode: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('a') }),
      z.strictObject({ kind: z.literal('b'), note: z.string().meta(field('The note.')) }),
    ])
    .default({ kind: 'a' })
    .meta(field('How the mode works.')),
});

function Picker({ options, value, onChange, describedBy, help, helpId }: UnionPickerProps) {
  return (
    <>
      {helpId === undefined ? null : (
        <HelpText id={helpId}>{`Drawn by the picker: ${help}`}</HelpText>
      )}
      <Label htmlFor="mode-picker">Choice</Label>
      <Select
        id="mode-picker"
        value={value}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </>
  );
}

const drawing: UnionPicker = Object.assign((props: UnionPickerProps) => <Picker {...props} />, {
  drawsHelp: true,
});
const plain: UnionPicker = (props: UnionPickerProps) => <Picker {...props} />;

it('lets a picker that draws help place the union help, still describing the control', async () => {
  const user = userEvent.setup();
  const spy = vi.fn();
  render(
    <SchemaForm
      schema={schema}
      value={{}}
      label="form"
      unionPickers={{ mode: drawing }}
      onChange={spy}
    />,
  );
  const group = screen.getByRole('group', { name: 'Mode' });
  const select = within(group).getByRole('combobox', { name: 'Choice' });
  // The union's help appears once, where the picker put it: before the picker's label.
  expect(within(group).getAllByText(/How the mode works\./)).toHaveLength(1);
  const help = within(group).getByText('Drawn by the picker: How the mode works.');
  expect(
    help.compareDocumentPosition(within(group).getByText('Choice')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(select).toHaveAccessibleDescription('Drawn by the picker: How the mode works.');
  // The union field keeps the variant change and its fields.
  await user.selectOptions(select, 'b');
  expect(spy).toHaveBeenLastCalledWith({ mode: { kind: 'b', note: '' } }, expect.anything());
  expect(within(group).getByRole('textbox', { name: 'Note' })).toHaveAccessibleDescription(
    /^The note\./,
  );
});

it('keeps drawing the union help after a picker that does not opt in', () => {
  render(
    <SchemaForm
      schema={schema}
      value={{}}
      label="form"
      unionPickers={{ mode: plain }}
      onChange={vi.fn()}
    />,
  );
  const group = screen.getByRole('group', { name: 'Mode' });
  expect(within(group).queryByText(/Drawn by the picker/)).toBeNull();
  const help = within(group).getByText('How the mode works.');
  const select = within(group).getByRole('combobox', { name: 'Choice' });
  expect(select.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(select).toHaveAccessibleDescription('How the mode works.');
});
