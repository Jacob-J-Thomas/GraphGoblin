import { Fragment, useState, type ReactNode } from 'react';

/** Deliberately small Markdown surface: React escapes HTML; no images or embeds are loaded. */
function inline(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|!?\[[^\]\n]*\]\([^\s)]+\))/g;
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    if (index > end) parts.push(value.slice(end, index));
    const token = match[0];
    let node: ReactNode = token;
    if (token.startsWith('`'))
      node = (
        <code className="rounded bg-surface-raised px-1 font-mono text-sm">
          {token.slice(1, -1)}
        </code>
      );
    else if (token.startsWith('**')) node = <strong>{token.slice(2, -2)}</strong>;
    else if (token.startsWith('*')) node = <em>{token.slice(1, -1)}</em>;
    else if (!token.startsWith('!')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      try {
        const url = new URL(href);
        if (['https:', 'http:', 'mailto:'].includes(url.protocol))
          node = (
            <a href={url.href} rel="noopener noreferrer" target="_blank">
              {label}
              {url.hostname && label !== url.hostname ? (
                <span className="text-xs text-subtle"> ({url.hostname})</span>
              ) : null}
            </a>
          );
      } catch {
        /* Invalid/relative/unsafe links stay visible as text. */
      }
    }
    parts.push(<Fragment key={index}>{node}</Fragment>);
    end = index + token.length;
  }
  if (end < value.length) parts.push(value.slice(end));
  return parts;
}
export function ChatMarkdown({ text }: { text: string }) {
  const blocks = text.split(/(```[^\n]*\n[\s\S]*?(?:\n```|$))/g);
  return (
    <div className="grid gap-3 text-[15px] leading-normal wrap-anywhere">
      {blocks.map((block, index) => {
        if (!block) return null;
        if (block.startsWith('```')) {
          const first = block.indexOf('\n');
          const code = block.slice(first + 1).replace(/\n```$/, '');
          return (
            <pre
              key={index}
              className="max-w-full overflow-x-auto rounded-lg border border-default bg-surface-raised p-3 text-sm"
            >
              <code>{code}</code>
            </pre>
          );
        }
        const lines = block.split('\n');
        const content: ReactNode[] = [];
        let line = 0;
        while (line < lines.length) {
          const current = lines[line]!;
          if (!current.trim()) {
            line++;
            continue;
          }
          const heading = /^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(current);
          if (heading) {
            content.push(
              <p key={`${index}-${line}`} className="font-semibold text-heading">
                {inline(heading[1]!)}
              </p>,
            );
            line++;
            continue;
          }
          const ordered = /^\s*\d+[.)]\s+/.test(current);
          const unordered = /^\s*[-*+]\s+/.test(current);
          if (ordered || unordered) {
            const List = ordered ? 'ol' : 'ul';
            const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
            const start = line;
            const items: ReactNode[] = [];
            while (line < lines.length && pattern.test(lines[line]!)) {
              items.push(<li key={line}>{inline(lines[line]!.replace(pattern, ''))}</li>);
              line++;
            }
            content.push(
              <List
                key={`${index}-${start}`}
                className={`ml-5 grid gap-1 ${ordered ? 'list-decimal' : 'list-disc'}`}
              >
                {items}
              </List>,
            );
            continue;
          }
          const start = line;
          const paragraph = [current];
          line++;
          while (
            line < lines.length &&
            lines[line]!.trim() &&
            !/^\s*(?:#{1,6}\s+|\d+[.)]\s+|[-*+]\s+)/.test(lines[line]!)
          ) {
            paragraph.push(lines[line]!);
            line++;
          }
          content.push(
            <p key={`${index}-${start}`} className="whitespace-pre-wrap">
              {inline(paragraph.join('\n'))}
            </p>,
          );
        }
        return content;
      })}
    </div>
  );
}
export function CopyReply({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded px-1.5 py-1 text-xs text-subtle opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? 'Copied' : 'Copy reply'}
    </button>
  );
}
