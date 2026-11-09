import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatMarkdown, CopyReply } from './ChatMarkdown.js';
describe('safe chat Markdown', () => {
  it('renders readable inline text, lists and fenced code without interpreting HTML or loading media', () => {
    const { container } = render(
      <ChatMarkdown
        text={
          '**Strong** and *emphasis* and `inline`\n\n- one\n- two\n\n1. first\n2. next\n\n```js\nconst value = 1;\n```\n\n<script>alert(1)</script> ![remote](https://tracker.test/pixel) [bad](javascript:alert) [relative](/private) [good](https://example.com/help) [mail](mailto:a@example.com)'
        }
      />,
    );
    expect(container.querySelector('strong')).toHaveTextContent('Strong');
    expect(container.querySelector('em')).toHaveTextContent('emphasis');
    expect(container.querySelector('ul')).toHaveTextContent('one');
    expect(container.querySelector('ol')).toHaveTextContent('first');
    expect(container.querySelector('pre code')).toHaveTextContent('const value = 1;');
    expect(container.querySelector('script,img,iframe')).toBeNull();
    expect(screen.getByRole('link', { name: /good/ })).toHaveAttribute(
      'href',
      'https://example.com/help',
    );
    expect(screen.getByRole('link', { name: /good/ })).toHaveTextContent('example.com');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
  it('copies original reply text and quietly handles an unavailable clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CopyReply text="Original **text**" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy reply' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
    expect(writeText).toHaveBeenCalledWith('Original **text**');
    writeText.mockRejectedValue(new Error('blocked'));
    fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
    expect(await screen.findByRole('button', { name: 'Copy reply' })).toBeVisible();
  });
});

it('renders common headings and an introduction followed immediately by lists, keeping unsafe content inert', () => {
  const { container } = render(
    <ChatMarkdown
      text={
        '### A useful answer\nIntro:\n- first **item**\n- second item\nMore detail.\n1. Do this\n2. Then that\n<script>bad()</script>\n## [unsafe](javascript:alert) ![remote](https://tracker.test/pixel)'
      }
    />,
  );
  expect(screen.getByText('A useful answer')).toHaveClass('font-semibold');
  expect(screen.getByText('Intro:')).toBeVisible();
  expect(container.querySelector('ul')?.children).toHaveLength(2);
  expect(container.querySelector('ol')?.children).toHaveLength(2);
  expect(screen.getByText('More detail.')).toBeVisible();
  expect(container.querySelector('script,img,iframe,a')).toBeNull();
});
