import { NodeKindSchema, RunStatusSchema } from '@graphgoblin/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunStatusBadge } from '../status.js';
import { GoblinMark, Icon, ICON_NAMES, KindIcon, Logo, StatusIcon } from './index.js';

describe('icons', () => {
  it('draws every glyph as a decorative, currentColor stroke icon', () => {
    const { container } = render(
      <>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} className="text-muted" />
        ))}
      </>,
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(ICON_NAMES.length);
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('stroke', 'currentColor');
      expect(svg).toHaveClass('size-4', 'text-muted');
      expect(svg.childElementCount).toBeGreaterThan(0);
    }
  });

  it('has a glyph for every node kind and run status', () => {
    const { container } = render(
      <>
        {NodeKindSchema.options.map((kind) => (
          <KindIcon key={kind} kind={kind} />
        ))}
        {RunStatusSchema.options.map((status) => (
          <StatusIcon key={status} status={status} />
        ))}
      </>,
    );
    const names = [...container.querySelectorAll('svg')].map((svg) => svg.dataset['icon']);
    expect(names.slice(0, NodeKindSchema.options.length)).toEqual(NodeKindSchema.options);
    expect(names).toContain('wait');
    expect(names).not.toContain(undefined);
  });
});

describe('Logo', () => {
  it('pairs the goblin mark with the wordmark on the header', () => {
    const { container } = render(<Logo className="extra" />);
    expect(container.firstElementChild).toHaveClass('text-inverse', 'extra');
    expect(container.firstElementChild).toHaveTextContent('GraphGoblin');
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Goblin')).toHaveClass('text-accent');
  });

  it('offers the wordmark alone, and a variant for raised surfaces', () => {
    const { container } = render(<Logo variant="wordmark" surface="raised" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.firstElementChild).toHaveClass('text-default');
    expect(screen.getByText('Goblin')).toHaveClass('text-accent-strong');
  });

  it('draws the mark at any size', () => {
    const { container } = render(<GoblinMark className="size-16" />);
    expect(container.querySelector('svg')).toHaveClass('size-16');
  });
});

describe('RunStatusBadge', () => {
  it('keeps the status word and data attribute, with an icon and the running glow', () => {
    render(
      <>
        {RunStatusSchema.options.map((status) => (
          <RunStatusBadge key={status} status={status} />
        ))}
      </>,
    );
    // The word sits in the badge's text span, beside the icon.
    const badge = (status: string) => screen.getByText(status).parentElement;
    for (const status of RunStatusSchema.options) {
      expect(badge(status)).toHaveAttribute('data-status', status);
      expect(badge(status)?.querySelector('svg')).not.toBeNull();
    }
    expect(badge('running')).toHaveClass('glow-running', 'bg-status-info-bg');
    expect(badge('running')?.querySelector('svg')).toHaveClass('animate-pulse-soft');
    expect(badge('succeeded')).toHaveClass('bg-status-good-bg');
    expect(badge('failed')).toHaveClass('bg-status-bad-bg');
    expect(badge('failed')).not.toHaveClass('glow-running');
    expect(badge('failed')?.querySelector('svg')).not.toHaveClass('animate-pulse-soft');
  });
});
