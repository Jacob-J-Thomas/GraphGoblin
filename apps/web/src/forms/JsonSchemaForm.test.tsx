import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JsonSchemaForm } from './JsonSchemaForm.js';
import { renderPreview } from './preview.js';

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
    await user.selectOptions(screen.getByLabelText('mode'), 'slow');
    await user.type(screen.getByLabelText('tags'), 'not json');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('alert')).toHaveTextContent('tags: invalid JSON');

    await user.clear(screen.getByLabelText('tags'));
    await user.type(screen.getByLabelText('tags'), '[["a"]');
    await user.type(screen.getByLabelText('note'), 'hi');
    await user.click(screen.getByLabelText('ok'));
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
    const priority = screen.getByLabelText('priority');
    expect(
      within(priority)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['(choose)', '1', '2']);
    await user.selectOptions(priority, '1');
    await user.selectOptions(screen.getByLabelText('strict'), 'null');
    // A string and a number with the same text stay apart.
    const mode = screen.getByLabelText('mode');
    expect(
      within(mode)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['(choose)', '"1"', '1']);
    await user.selectOptions(mode, '"1"');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submit).toHaveBeenLastCalledWith({ priority: 1, strict: null, mode: '1' });

    await user.selectOptions(screen.getByLabelText('strict'), 'false');
    await user.selectOptions(mode, '1');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(submit).toHaveBeenLastCalledWith({ priority: 1, strict: false, mode: 1 });
  });

  it('falls back to a JSON editor for non-object schemas or none', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const { unmount } = render(
      <JsonSchemaForm schema={{ type: 'number' }} submitLabel="Send" onSubmit={submit} />,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenLastCalledWith(undefined);
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
