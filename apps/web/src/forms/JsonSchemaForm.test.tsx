import { render, screen, within } from '@testing-library/react';
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

describe('JsonSchemaForm', () => {
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
    expect(screen.getByRole('alert')).toHaveTextContent(/count/);
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

  it('sends an enum choice as the value it stands for, not its text', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit).toHaveBeenLastCalledWith({ priority: 1, strict: null, mode: '1' });

    await user.click(radio('strict', 'false'));
    await user.click(radio('mode', '1'));
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

    // A required boolean and a defaulted one are switches; the default shows as help.
    const approved = screen.getByRole('switch', { name: 'approved' });
    expect(approved).toHaveAttribute('aria-required', 'true');
    const notify = screen.getByRole('switch', { name: 'notify' });
    expect(notify).toHaveAccessibleDescription('Default: true');
    await user.click(approved);
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
