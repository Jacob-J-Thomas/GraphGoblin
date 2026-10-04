import { describe, expect, it } from 'vitest';
import { variants } from './variants.js';

const button = variants({
  base: ['base', { never: false }],
  variants: {
    tone: { plain: 'tone-plain', loud: ['tone-loud', 'bold'] },
    size: { sm: 'size-sm', md: 'size-md' },
  },
  defaults: { tone: 'plain', size: 'md' },
});

describe('variants', () => {
  it('applies the base, the defaults, and the chosen variants in order', () => {
    expect(button()).toBe('base tone-plain size-md');
    expect(button({ tone: 'loud' })).toBe('base tone-loud bold size-md');
    expect(button({ size: 'sm', className: 'extra' })).toBe('base tone-plain size-sm extra');
  });

  it('falls back to the default for an explicitly undefined choice', () => {
    expect(button({ tone: undefined, size: undefined })).toBe('base tone-plain size-md');
  });

  it('drops a choice the groups do not know', () => {
    const unknown = { size: 'xl' } as unknown as Parameters<typeof button>[0];
    expect(button(unknown)).toBe('base tone-plain');
  });

  it('works without a base', () => {
    const bare = variants({ variants: { on: { yes: 'y', no: 'n' } }, defaults: { on: 'no' } });
    expect(bare({ on: 'yes' })).toBe('y');
  });
});
