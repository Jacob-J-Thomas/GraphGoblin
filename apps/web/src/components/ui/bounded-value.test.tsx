import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedValue, CELL_PREVIEW_CHARS, VALUE_PREVIEW_CHARS } from './bounded-value.js';

const big = { items: Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'x'.repeat(40) })) };
const bigJson = JSON.stringify(big, null, 2);

describe('BoundedValue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders a small value completely, without controls', () => {
    render(<BoundedValue value={{ topic: 'loops' }} label="Variables" labelled testId="value" />);
    expect(screen.getByTestId('value')).toHaveTextContent('"topic": "loops"');
    expect(screen.getByLabelText('Variables').textContent).toBe('{\n  "topic": "loops"\n}');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it('shows the first characters of a large value and the rest on request', async () => {
    const user = userEvent.setup();
    expect(bigJson.length).toBeGreaterThan(VALUE_PREVIEW_CHARS);
    render(<BoundedValue value={big} label="Variables" testId="value" />);
    const shown = screen.getByTestId('value').textContent ?? '';
    expect(shown).toBe(`${bigJson.slice(0, VALUE_PREVIEW_CHARS)}…`);
    // The total is unknown while collapsed: counting it would mean formatting the whole value.
    expect(
      screen.getByText(
        `Showing the first ${VALUE_PREVIEW_CHARS.toLocaleString('en-US')} characters of a larger value.`,
      ),
    ).toBeInTheDocument();
    // Nothing scrolls yet, so the preview is plain text: not a focusable region, and not named
    // (a name would hide the text from the accessible name of a row around it).
    expect(screen.queryByRole('region', { name: 'Variables' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Variables')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    expect(screen.getByTestId('value').textContent).toBe(bigJson);
    const region = screen.getByRole('region', { name: 'Variables' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(
      screen.getByText(`Showing all ${bigJson.length.toLocaleString('en-US')} characters.`),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show less of Variables' }));
    expect(screen.getByTestId('value').textContent).toBe(
      `${bigJson.slice(0, VALUE_PREVIEW_CHARS)}…`,
    );
  });

  it('honours a tighter bound for table cells', () => {
    render(
      <BoundedValue value={big} label="Payload" previewChars={CELL_PREVIEW_CHARS} testId="value" />,
    );
    expect(screen.getByTestId('value').textContent).toBe(
      `${bigJson.slice(0, CELL_PREVIEW_CHARS)}…`,
    );
  });

  it('downloads the exact stored value, not the shown text', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    const create = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:value';
    });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<BoundedValue value={big} label="Variables" fileName="run-1-variables" />);

    await user.click(screen.getByRole('button', { name: 'Download Variables as JSON' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs).toHaveLength(1);
    expect(JSON.parse(await blobs[0]!.text())).toEqual(big);
    expect(revoke).toHaveBeenCalledWith('blob:value');
  });

  it('offers no download without a file name', () => {
    render(<BoundedValue value={big} label="Variables" />);
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toBeInTheDocument();
  });

  it('shows a string as text when asked, and the empty text for nothing', () => {
    const { rerender } = render(
      <BoundedValue value={'line one\nline "two"'} text label="Message" testId="value" />,
    );
    expect(screen.getByTestId('value').textContent).toBe('line one\nline "two"');
    rerender(<BoundedValue value={'quoted'} label="Message" testId="value" />);
    expect(screen.getByTestId('value').textContent).toBe('"quoted"');
    rerender(<BoundedValue value={undefined} label="Before" emptyText="(absent)" testId="value" />);
    expect(screen.getByTestId('value').textContent).toBe('(absent)');
  });

  it('bounds a long string shown as text and knows its total', async () => {
    const user = userEvent.setup();
    const long = 'word '.repeat(2_000);
    render(<BoundedValue value={long} text label="Message" testId="value" />);
    expect(screen.getByTestId('value').textContent).toBe(`${long.slice(0, VALUE_PREVIEW_CHARS)}…`);
    expect(screen.getByText('Showing the first 4,096 of 10,000 characters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all of Message' }));
    expect(screen.getByTestId('value').textContent).toBe(long);
  });

  it('formats only the preview while collapsed and the whole value once expanded', async () => {
    const user = userEvent.setup();
    let visited = 0;
    const lazy = {
      head: 'h'.repeat(VALUE_PREVIEW_CHARS + 10),
      get tail(): string {
        visited += 1;
        return 'tail';
      },
    };
    render(<BoundedValue value={lazy} label="Variables" testId="value" />);
    expect(screen.getByTestId('value').textContent?.length).toBe(VALUE_PREVIEW_CHARS + 1);
    expect(visited).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(lazy, null, 2));
    expect(visited).toBeGreaterThan(0);
  });

  it('starts bounded again when another value is shown, and when the first one returns', async () => {
    const user = userEvent.setup();
    const other = {
      items: Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'y'.repeat(40) })),
    };
    const { rerender } = render(<BoundedValue value={big} label="Variables" testId="value" />);
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    expect(screen.getByTestId('value').textContent).toBe(bigJson);
    rerender(<BoundedValue value={other} label="Variables" testId="value" />);
    expect(screen.getByTestId('value').textContent?.length).toBe(VALUE_PREVIEW_CHARS + 1);
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toBeInTheDocument();
    // Returning to the expanded value (the same reference, from the thread cache) lays out the
    // preview again: the bound is on what is shown now, not on what the reader once chose
    // (QA-259-01, a 2.3 MB value rendered whole by ordinary timeline navigation).
    rerender(<BoundedValue value={big} label="Variables" testId="value" />);
    expect(screen.getByTestId('value').textContent).toBe(
      `${bigJson.slice(0, VALUE_PREVIEW_CHARS)}…`,
    );
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toBeInTheDocument();
    // An unchanged value keeps its expansion across re-renders.
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    rerender(<BoundedValue value={big} label="Variables" testId="value" className="mt-1" />);
    expect(screen.getByTestId('value').textContent).toBe(bigJson);
  });

  it('keeps the keyboard inside the component when a change of value collapses the region', async () => {
    const user = userEvent.setup();
    const other = {
      items: Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'y'.repeat(40) })),
    };
    const { rerender } = render(<BoundedValue value={big} label="Variables" testId="value" />);
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => screen.getByRole('region', { name: 'Variables' }).focus());
    expect(screen.getByRole('region', { name: 'Variables' })).toHaveFocus();
    // Large to large: the new value's Show all takes the focus.
    rerender(<BoundedValue value={other} label="Variables" testId="value" />);
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toHaveFocus();
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
    // Large to small: the text itself keeps it, without becoming a tab stop, until it moves on.
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => screen.getByRole('region', { name: 'Variables' }).focus());
    rerender(<BoundedValue value={{ topic: 'loops' }} label="Variables" testId="value" />);
    expect(screen.getByTestId('value')).toHaveFocus();
    expect(screen.getByTestId('value')).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(screen.getByTestId('value')).not.toHaveFocus();
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
    // A keyboard elsewhere is left alone.
    rerender(<BoundedValue value={big} label="Variables" testId="value" />);
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => (document.activeElement as HTMLElement).blur());
    rerender(<BoundedValue value={other} label="Variables" testId="value" />);
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
  });

  it('does not replay a finished hand-off when its value returns while the keyboard is elsewhere', async () => {
    const user = userEvent.setup();
    const other = {
      items: Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'y'.repeat(40) })),
    };
    const page = (value: unknown) => (
      <>
        <BoundedValue value={value} label="Variables" testId="value" />
        <button type="button">Timeline</button>
      </>
    );
    const { rerender } = render(page(big));
    // The first value is expanded with the keyboard inside; the second one's arrival hands the
    // keyboard to its Show all.
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => screen.getByRole('region', { name: 'Variables' }).focus());
    rerender(page(other));
    expect(screen.getByRole('button', { name: 'Show all of Variables' })).toHaveFocus();
    // The reader moves to the timeline and selects the first value, then the second one again:
    // the keyboard stays on the timeline both times.
    act(() => screen.getByRole('button', { name: 'Timeline' }).focus());
    rerender(page(big));
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveFocus();
    rerender(page(other));
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveFocus();
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
  });

  it('hands the keyboard over when the control it was on disappears with the value', async () => {
    const user = userEvent.setup();
    const small = { topic: 'loops' };
    const { rerender } = render(
      <BoundedValue value={big} label="Variables" fileName="variables" testId="value" />,
    );
    // Collapsed, keyboard on Show all; the next value is small and has no controls.
    act(() => screen.getByRole('button', { name: 'Show all of Variables' }).focus());
    rerender(<BoundedValue value={small} label="Variables" fileName="variables" testId="value" />);
    expect(screen.getByTestId('value')).toHaveFocus();
    expect(screen.getByTestId('value')).toHaveAttribute('tabindex', '-1');
    // Expanded, keyboard on Download; the controls go, the text takes the keyboard.
    rerender(<BoundedValue value={big} label="Variables" fileName="variables" testId="value" />);
    await user.click(screen.getByRole('button', { name: 'Show all of Variables' }));
    act(() => screen.getByRole('button', { name: 'Download Variables as JSON' }).focus());
    rerender(<BoundedValue value={small} label="Variables" fileName="variables" testId="value" />);
    expect(screen.getByTestId('value')).toHaveFocus();
    // Keyboard on a control that survives the change: it stays there.
    rerender(<BoundedValue value={big} label="Variables" fileName="variables" testId="value" />);
    act(() => screen.getByRole('button', { name: 'Download Variables as JSON' }).focus());
    rerender(
      <BoundedValue
        value={{ items: Array.from({ length: 400 }, (_, i) => ({ id: i, note: 'z'.repeat(40) })) }}
        label="Variables"
        fileName="variables"
        testId="value"
      />,
    );
    expect(screen.getByRole('button', { name: 'Download Variables as JSON' })).toHaveFocus();
    expect(screen.getByTestId('value')).not.toHaveAttribute('tabindex');
  });
});
