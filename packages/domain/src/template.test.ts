import { describe, expect, it } from 'vitest';
import { TemplateError } from './errors.js';
import { checkTemplate, renderTemplate } from './template.js';

describe('renderTemplate', () => {
  it('renders variables, filters, and control flow', async () => {
    const out = await renderTemplate(
      'Hello {{ name | upcase }}{% if n > 1 %} x{{ n }}{% endif %}',
      {
        name: 'loops',
        n: 2,
      },
    );
    expect(out).toBe('Hello LOOPS x2');
  });

  it('renders missing variables as empty strings', async () => {
    expect(await renderTemplate('[{{ missing }}]', {})).toBe('[]');
  });

  it('throws TemplateError on unknown filters', async () => {
    await expect(renderTemplate('{{ a | nope }}', { a: 1 })).rejects.toBeInstanceOf(TemplateError);
  });

  it('throws TemplateError on syntax errors', async () => {
    await expect(renderTemplate('{% if %}', {})).rejects.toBeInstanceOf(TemplateError);
  });

  it('refuses includes because the filesystem is disabled', async () => {
    await expect(renderTemplate('{% include "x" %}', {})).rejects.toBeInstanceOf(TemplateError);
  });

  it('stringifies non-string output', async () => {
    expect(await renderTemplate('{{ n }}', { n: 42 })).toBe('42');
  });
});

describe('checkTemplate', () => {
  it('returns null for valid templates and a message otherwise', () => {
    expect(checkTemplate('{{ a }}')).toBeNull();
    expect(checkTemplate('{% if %}')).toMatch(/invalid value expression/i);
  });
});
