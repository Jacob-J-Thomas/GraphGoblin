import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JsonSchemaForm } from './JsonSchemaForm.js';
import { renderPreview } from './preview.js';

/** The radio named `option` in the radio group (segmented control) named `group`. */
function radio(group: string, option: string) {
  return within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', {
    name: option,
  });
}

/** The names of the radios in the radio group named `group`, in order. */
function radioNames(group: string) {
  return within(screen.getByRole('radiogroup', { name: group }))
    .getAllByRole('radio')
    .map((r) => r.closest('label')?.textContent);
}

/** Every Omit button in the document, by accessible name. */
function omitButtons() {
  return screen
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? '')
    .filter((name) => name.startsWith('Omit'));
}

describe('JsonSchemaForm', () => {
  it('keeps untouched fields absent and sends explicitly empty text, null, zero and false', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{
          type: 'object',
          properties: {
            untouched: { type: 'string' },
            note: { type: 'string', default: 'none' },
            details: { type: 'null' },
            count: { type: 'integer' },
            approved: { type: 'boolean' },
          },
        }}
        submitLabel="Send"
        onSubmit={submit}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith({});
    // Nothing to omit until something is entered; an absent field shows its default as the hint.
    expect(omitButtons()).toEqual([]);
    const note = screen.getByLabelText('note');
    expect(note).toHaveAttribute('placeholder', 'none');

    // Cleared text is the empty string, and says so: the default no longer applies.
    await user.type(note, 'remove me');
    await user.clear(note);
    expect(note).toHaveAttribute('placeholder', '""');
    await user.type(screen.getByLabelText('details'), 'null');
    await user.type(screen.getByLabelText('count'), '0');
    await user.click(radio('approved', 'No'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith({ note: '', details: null, count: 0, approved: false });
    expect(omitButtons()).toEqual(['Omit note', 'Omit details', 'Omit count']);

    // Omit puts the field back as it started, and keeps focus on it.
    await user.click(screen.getByRole('button', { name: 'Omit note' }));
    expect(note).toHaveFocus();
    expect(note).toHaveValue('');
    expect(note).toHaveAttribute('placeholder', 'none');
    expect(screen.queryByRole('button', { name: 'Omit note' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith({ details: null, count: 0, approved: false });
  });

  it('omits by keyboard: Shift+Tab from the field reaches Omit, and Enter returns to the field', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{ type: 'object', properties: { note: { type: 'string' } } }}
        submitLabel="Send"
        onSubmit={submit}
      />,
    );
    const note = screen.getByLabelText('note');
    await user.click(note);
    await user.keyboard('x{Backspace}');
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Omit note' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(note).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith({});
  });

  it('offers Omit only for edited optional text, number and JSON fields, never for required ones', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{
          type: 'object',
          required: ['name', 'size', 'data'],
          properties: {
            name: { type: 'string' },
            size: { type: 'integer' },
            data: { type: 'array' },
            tone: { enum: ['warm', 'cool'] },
            flag: { type: 'boolean' },
            note: { type: 'string' },
          },
        }}
        submitLabel="Send"
        onSubmit={submit}
      />,
    );
    const name = screen.getByLabelText('name');
    const size = screen.getByLabelText('size');
    await user.type(name, 'x');
    await user.clear(name);
    await user.type(size, '1');
    await user.clear(size);
    await user.type(screen.getByLabelText('data'), '[[]');
    // Choices go back with Not set, so they need no Omit.
    await user.click(radio('tone', 'warm'));
    await user.click(radio('flag', 'Yes'));
    await user.type(screen.getByLabelText('note'), 'n');
    expect(omitButtons()).toEqual(['Omit note']);

    // A required number left blank is refused as a number, not as missing; required text that is
    // cleared is the empty string, which this schema accepts.
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(size).toHaveAccessibleDescription('size: enter a number');
    expect(name).not.toHaveAttribute('aria-invalid');
    expect(submit).not.toHaveBeenCalled();
    await user.type(size, '2');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith({
      name: '',
      size: 2,
      data: [],
      tone: 'warm',
      flag: true,
      note: 'n',
    });
  });

  it('checks a number the browser reports as incomplete rather than leaving it out', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{ type: 'object', properties: { count: { type: 'number' } } }}
        submitLabel="Send"
        onSubmit={submit}
      />,
    );
    const count = screen.getByLabelText('count');
    // A native number input holding "-" reports an empty value with validity.badInput, which is
    // also what it reported before the key: only the input event says something was typed.
    let badInput = true;
    Object.defineProperty(count, 'validity', { configurable: true, get: () => ({ badInput }) });
    fireEvent.input(count, { target: { value: '' }, data: '-', inputType: 'insertText' });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(count).toHaveAttribute('aria-invalid', 'true');
    expect(count).toHaveAccessibleDescription('count: enter a number');
    expect(submit).not.toHaveBeenCalled();

    badInput = false;
    fireEvent.input(count, { target: { value: '-5' }, data: '5', inputType: 'insertText' });
    expect(count).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith({ count: -5 });
  });

  it('validates a cleared optional string against its schema and refuses edited number or JSON blanks', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1 },
            count: { type: 'integer' },
            list: { type: 'array' },
          },
        }}
        submitLabel="Send"
        onSubmit={submit}
      />,
    );
    const title = screen.getByLabelText('title');
    const count = screen.getByLabelText('count');
    const list = screen.getByLabelText('list');
    await user.type(title, 'x');
    await user.clear(title);
    await user.type(count, '1');
    await user.clear(count);
    await user.type(list, '[[]');
    await user.clear(list);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(title).toHaveAccessibleDescription('title must NOT have fewer than 1 characters');
    expect(count).toHaveAccessibleDescription('count: enter a number');
    expect(list).toHaveAccessibleDescription(/list: invalid JSON/);
    expect(submit).not.toHaveBeenCalled();

    for (const name of ['title', 'count', 'list']) {
      await user.click(screen.getByRole('button', { name: `Omit ${name}` }));
    }
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenCalledWith({});
  });

  it('keeps no input, edited blank JSON, null, "", 0 and false apart in the JSON editor', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{ type: ['string', 'number', 'boolean', 'null'] }}
        submitLabel="Send"
        onSubmit={submit}
      />,
    );
    const input = screen.getByLabelText('Input (JSON)');
    const send = screen.getByRole('button', { name: 'Send' });
    await user.click(send);
    expect(submit).toHaveBeenLastCalledWith(undefined);
    expect(omitButtons()).toEqual([]);
    await user.type(input, 'null');
    await user.click(send);
    expect(submit).toHaveBeenLastCalledWith(null);
    // Edited and then emptied, or only spaces: not JSON, and never quietly no input.
    await user.clear(input);
    await user.click(send);
    expect(input).toHaveAccessibleDescription(/^Invalid JSON/);
    await user.type(input, '  ');
    await user.click(send);
    expect(input).toHaveAccessibleDescription(/^Invalid JSON/);
    expect(submit).toHaveBeenCalledTimes(2);
    for (const [text, value] of [
      ['""', ''],
      ['0', 0],
      ['false', false],
    ] as const) {
      await user.clear(input);
      await user.type(input, text);
      await user.click(send);
      expect(submit).toHaveBeenLastCalledWith(value);
    }
    await user.click(screen.getByRole('button', { name: 'Omit input' }));
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    await user.click(send);
    expect(submit).toHaveBeenCalledTimes(6);
    expect(submit).toHaveBeenLastCalledWith(undefined);
  });

  it('offers no Omit in the JSON editor when the schema refuses no input', async () => {
    const user = userEvent.setup();
    render(<JsonSchemaForm schema={{ type: 'number' }} submitLabel="Send" onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText('Input (JSON)'), '1');
    expect(omitButtons()).toEqual([]);
  });

  it('renders one field per property and validates before submitting', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{
          type: 'object',
          required: ['count'],
          properties: {
            count: { type: 'integer', title: 'Count', description: 'How many' },
            mode: { enum: ['fast', 'slow'] },
            tags: { type: 'array' },
            note: { type: ['string', 'null'] },
            ok: { type: 'boolean' },
          },
        }}
        submitLabel="Go"
        onSubmit={submit}
      />,
    );
    expect(screen.getByText('How many')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go' }));
    // The problem shows beside its field, under the field's title, and describes its control.
    expect(screen.getByRole('alert')).toHaveTextContent('Count is required');
    expect(screen.getByLabelText('Count')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Count')).toHaveAccessibleDescription(
      'How many Count is required',
    );
    expect(submit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Count'), '3');
    await user.click(radio('mode', 'slow'));
    await user.type(screen.getByLabelText('tags'), 'not json');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('alert')).toHaveTextContent('tags: invalid JSON');

    await user.clear(screen.getByLabelText('tags'));
    await user.type(screen.getByLabelText('tags'), '[["a"]');
    await user.type(screen.getByLabelText('note'), 'hi');
    await user.click(radio('ok', 'Yes'));
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).toHaveBeenCalledWith({
      count: 3,
      mode: 'slow',
      tags: ['a'],
      note: 'hi',
      ok: true,
    });
  });

  it('sends each enum choice as its typed value', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{
          type: 'object',
          required: ['priority'],
          properties: {
            priority: { type: 'integer', enum: [1, 2] },
            strict: { enum: [true, false, null] },
            mode: { enum: ['1', 1] },
            optionalText: { enum: ['', 'filled'] },
            longText: { enum: ['', 'a', 'b', 'c', 'd'] },
          },
        }}
        submitLabel="Go"
        onSubmit={submit}
      />,
    );
    // A required enum offers its members only; an optional one also "Not set".
    expect(radioNames('priority')).toEqual(['1', '2']);
    await user.click(radio('priority', '1'));
    await user.click(radio('strict', 'null'));
    // A string and a number with the same text stay apart.
    expect(radioNames('mode')).toEqual(['Not set', '"1"', '1']);
    await user.click(radio('mode', '"1"'));
    // The empty string reads "" in segments and in a select, apart from Not set.
    expect(radioNames('optionalText')).toEqual(['Not set', '""', 'filled']);
    await user.click(radio('optionalText', '""'));
    const longText = screen.getByLabelText('longText');
    expect(
      within(longText)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Not set', '""', 'a', 'b', 'c', 'd']);
    await user.selectOptions(longText, '""');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit).toHaveBeenLastCalledWith({
      priority: 1,
      strict: null,
      mode: '1',
      optionalText: '',
      longText: '',
    });

    await user.click(radio('strict', 'false'));
    await user.click(radio('mode', '1'));
    await user.click(radio('optionalText', 'Not set'));
    await user.selectOptions(longText, 'Not set');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).toHaveBeenLastCalledWith({ priority: 1, strict: false, mode: 1 });
  });

  it('keeps an enum choice by value when the schema changes under a mounted form', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const form = (options: string[]) => (
      <JsonSchemaForm
        schema={{ type: 'object', properties: { decision: { enum: options } } }}
        submitLabel="Go"
        onSubmit={submit}
      />
    );
    const { rerender } = render(form(['deny', 'approve']));
    await user.click(radio('decision', 'deny'));

    // Reordered: still deny.
    rerender(form(['approve', 'deny']));
    expect(radio('decision', 'deny')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).toHaveBeenLastCalledWith({ decision: 'deny' });

    // No longer offered (a select now: one member): shown as not chosen, said so, and never
    // silently left out.
    submit.mockClear();
    rerender(form(['approve']));
    const decision = screen.getByLabelText('decision');
    expect(decision).toHaveDisplayValue('Not set');
    expect(decision).toHaveAccessibleDescription(/no longer offered/);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('alert')).toHaveTextContent('decision: "deny" is no longer offered');
    expect(submit).not.toHaveBeenCalled();

    // Choosing again (or choosing nothing) clears it.
    await user.selectOptions(decision, 'approve');
    expect(decision).not.toHaveAccessibleDescription(/no longer offered/);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).toHaveBeenLastCalledWith({ decision: 'approve' });
    await user.selectOptions(decision, 'Not set');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).toHaveBeenLastCalledWith({});
  });

  it('says so when a segmented choice is no longer offered, and keeps the required ones marked', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const form = (options: string[]) => (
      <JsonSchemaForm
        schema={{
          type: 'object',
          required: ['decision', 'approved', 'reason'],
          properties: {
            decision: { enum: options, description: 'What to do next' },
            approved: { type: 'boolean' },
            notify: { type: 'boolean', default: true },
            reason: { type: 'string', default: 'none given' },
            area: { enum: ['web', 'api', 'engine', 'docs', 'infra'] },
          },
        }}
        submitLabel="Go"
        onSubmit={submit}
      />
    );
    const { rerender } = render(form(['deny', 'approve']));
    expect(screen.getByText(/Required fields are marked/)).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'decision' });
    expect(group).toHaveAttribute('aria-required', 'true');
    expect(group).toHaveAccessibleDescription('What to do next');
    // Required: no "Not set", and nothing chosen until the user chooses.
    expect(radioNames('decision')).toEqual(['deny', 'approve']);
    expect(radio('decision', 'deny')).not.toBeChecked();
    await user.click(radio('decision', 'deny'));
    rerender(form(['approve', 'escalate']));
    expect(radio('decision', 'approve')).not.toBeChecked();
    expect(radio('decision', 'escalate')).not.toBeChecked();
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAccessibleDescription(/What to do next.*no longer offered/);
    await user.click(radio('decision', 'escalate'));
    expect(group).not.toHaveAttribute('aria-invalid');

    // Booleans show only what would be sent: a required one starts with neither Yes nor No, an
    // optional one (even with a default, shown as help) at "Not set".
    expect(radioNames('approved')).toEqual(['Yes', 'No']);
    expect(screen.getByRole('radiogroup', { name: 'approved' })).toHaveAttribute(
      'aria-required',
      'true',
    );
    expect(radio('approved', 'Yes')).not.toBeChecked();
    expect(radio('approved', 'No')).not.toBeChecked();
    expect(radio('notify', 'Not set')).toBeChecked();
    expect(screen.getByRole('radiogroup', { name: 'notify' })).toHaveAccessibleDescription(
      'Default: true',
    );
    await user.click(radio('approved', 'Yes'));
    // A string default is a placeholder; five members make a select with "Not set".
    expect(screen.getByLabelText('reason')).toHaveAttribute('placeholder', 'none given');
    expect(screen.getByLabelText('reason')).toBeRequired();
    await user.type(screen.getByLabelText('reason'), 'ok');
    expect(screen.getByLabelText('area')).toHaveDisplayValue('Not set');
    await user.selectOptions(screen.getByLabelText('area'), 'docs');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).toHaveBeenLastCalledWith({
      decision: 'escalate',
      approved: true,
      reason: 'ok',
      area: 'docs',
    });
    // The note appears only when something is required.
    rerender(
      <JsonSchemaForm
        schema={{ type: 'object', properties: { area: { enum: ['web'] } } }}
        submitLabel="Go"
        onSubmit={submit}
      />,
    );
    expect(screen.queryByText(/Required fields are marked/)).toBeNull();
  });

  it('gives each field its own ids, whatever its property is called', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Who asked' },
            'name-help': { type: 'string' },
            'review status': { type: 'string', description: 'Where the review stands' },
            // A computed key: an own property named __proto__, as JSON.parse would make it.
            ['__proto__']: { type: 'string' },
          },
        }}
        submitLabel="Go"
        onSubmit={submit}
      />,
    );
    const name = screen.getByRole('textbox', { name: 'name' });
    const nameHelp = screen.getByRole('textbox', { name: 'name-help' });
    const review = screen.getByRole('textbox', { name: 'review status' });
    expect(name).toHaveAccessibleDescription('Who asked');
    expect(nameHelp).not.toHaveAttribute('aria-describedby');
    expect(review).toHaveAccessibleDescription('Where the review stands');
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [name.id, nameHelp.id, review.id]) expect(id).not.toMatch(/name|review/);
    await user.type(name, 'Ada');
    await user.type(nameHelp, 'b');
    await user.type(review, 'open');
    await user.type(screen.getByRole('textbox', { name: '__proto__' }), 'own');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    const sent = submit.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    // Every property is sent as an own property, __proto__ included.
    expect(Object.entries(sent)).toEqual([
      ['name', 'Ada'],
      ['name-help', 'b'],
      ['review status', 'open'],
      ['__proto__', 'own'],
    ]);
    expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
  });

  it('puts each problem beside its field: required boolean, text, enum, and the value as a whole', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <JsonSchemaForm
        schema={{
          type: 'object',
          required: ['approved', 'risk'],
          minProperties: 3,
          properties: {
            approved: { type: 'boolean', title: 'Approval', description: 'Ship it?' },
            reason: { type: 'string', title: 'Reason', minLength: 3 },
            risk: { enum: ['low', 'high'], title: 'Risk' },
          },
        }}
        submitLabel="Go"
        onSubmit={submit}
      />,
    );
    await user.type(screen.getByLabelText('Reason'), 'ab');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).not.toHaveBeenCalled();
    const approval = screen.getByRole('radiogroup', { name: 'Approval' });
    expect(approval).toHaveAttribute('aria-invalid', 'true');
    expect(approval).toHaveAccessibleDescription('Ship it? Approval is required');
    const reason = screen.getByLabelText('Reason');
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason).toHaveAccessibleDescription('Reason must NOT have fewer than 3 characters');
    const risk = screen.getByRole('radiogroup', { name: 'Risk' });
    expect(risk).toHaveAttribute('aria-invalid', 'true');
    expect(risk).toHaveAccessibleDescription('Risk is required');
    // Each field's problem is announced; only the problem with no field goes to the summary,
    // and no message speaks in JSON Pointers about a field.
    const alerts = screen.getAllByRole('alert').map((alert) => alert.textContent);
    expect(alerts).toEqual([
      'Approval is required',
      'Reason must NOT have fewer than 3 characters',
      'Risk is required',
      '/ must NOT have fewer than 3 properties',
    ]);
    expect(alerts.join(' ')).not.toMatch(/required property/);

    // Editing a field clears its own problem only.
    await user.click(radio('Approval', 'Yes'));
    expect(approval).not.toHaveAttribute('aria-invalid');
    expect(approval).toHaveAccessibleDescription('Ship it?');
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    await user.type(reason, 'c');
    expect(reason).not.toHaveAttribute('aria-invalid');
    expect(reason).not.toHaveAttribute('aria-describedby');
    await user.click(radio('Risk', 'high'));
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit).toHaveBeenLastCalledWith({ approved: true, reason: 'abc', risk: 'high' });
  });

  it('links the raw JSON editor to its problems, whether the text does not parse or does not fit', async () => {
    const user = userEvent.setup();
    render(<JsonSchemaForm schema={{ type: 'number' }} submitLabel="Send" onSubmit={vi.fn()} />);
    const input = screen.getByLabelText('Input (JSON)');
    await user.type(input, '{{');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/^Invalid JSON/);
    await user.clear(input);
    expect(input).not.toHaveAttribute('aria-invalid');
    await user.type(input, '"x"');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('/ must be number');
    expect(screen.getByRole('alert')).toHaveTextContent('/ must be number');
  });

  it('checks an empty input against the schema as the API will (as null)', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const { unmount } = render(
      <JsonSchemaForm
        schema={{ type: 'string', minLength: 1 }}
        submitLabel="Send"
        onSubmit={submit}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('/ must be string');
    expect(submit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Input (JSON)'), '""');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('must NOT have fewer than 1 characters');
    await user.clear(screen.getByLabelText('Input (JSON)'));
    await user.type(screen.getByLabelText('Input (JSON)'), '"ok"');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith('ok');
    unmount();

    // A schema that takes null accepts the empty input, which is sent as no input at all.
    render(
      <JsonSchemaForm schema={{ type: ['string', 'null'] }} submitLabel="Send" onSubmit={submit} />,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit).toHaveBeenLastCalledWith(undefined);
  });

  it('falls back to a JSON editor for non-object schemas or none', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const { unmount } = render(
      <JsonSchemaForm schema={{ type: 'number' }} submitLabel="Send" onSubmit={submit} />,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('/ must be number');
    expect(submit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Input (JSON)'), '"x"');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('/ must be number');
    await user.clear(screen.getByLabelText('Input (JSON)'));
    await user.type(screen.getByLabelText('Input (JSON)'), '{{');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON');
    unmount();

    render(<JsonSchemaForm schema={undefined} submitLabel="Send" onSubmit={submit} />);
    await user.type(screen.getByLabelText('Input (JSON)'), '5');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith(5);
  });
});

describe('renderPreview', () => {
  it('renders templates and expressions against the sample thread, and reports errors', async () => {
    expect(await renderPreview('template', 'Topic {{ vars.topic }}')).toEqual({
      ok: true,
      output: 'Topic hello',
    });
    expect(await renderPreview('expression', 'vars.count * 2')).toEqual({ ok: true, output: '4' });
    expect(await renderPreview('expression', 'vars.missing')).toEqual({
      ok: true,
      output: '(no result)',
    });
    expect((await renderPreview('expression', '(((')).ok).toBe(false);
    expect((await renderPreview('template', '{% if %}')).ok).toBe(false);
  });
});
