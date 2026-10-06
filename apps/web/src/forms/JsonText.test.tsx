import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { getCode, setCode } from '../__fixtures__/codemirror.js';
import { JsonText } from './fields/json.js';

it('preserves unparsed text across value changes until discarded, then uses the latest value', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { rerender } = render(
    <JsonText path="value" label="Value" value={{ count: 1 }} onChange={onChange} />,
  );
  setCode('Value', '{oops');
  rerender(<JsonText path="value" label="Value" value={{ count: 2 }} onChange={onChange} />);
  expect(getCode('Value')).toBe('{oops');
  expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Discard the unparsed text' }));
  expect(JSON.parse(getCode('Value'))).toEqual({ count: 2 });
  expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument();
});

it('preserves typed JSON spacing when the form reports the accepted value back', () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <JsonText path="value" label="Value" value={{ count: 1 }} onChange={onChange} />,
  );
  const text = '{ "count" : 2 }';
  setCode('Value', text);
  expect(onChange).toHaveBeenLastCalledWith({ count: 2 });
  rerender(<JsonText path="value" label="Value" value={{ count: 2 }} onChange={onChange} />);
  expect(getCode('Value')).toBe(text);
  rerender(<JsonText path="value" label="Value" value={{ count: 3 }} onChange={onChange} />);
  expect(JSON.parse(getCode('Value'))).toEqual({ count: 3 });
});
