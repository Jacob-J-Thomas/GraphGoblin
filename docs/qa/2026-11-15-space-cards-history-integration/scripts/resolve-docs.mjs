// Resolves the two documentation conflict hunks. Reads the working files, never touches Git.
import { readFileSync, writeFileSync } from 'node:fs';

const repo = process.argv[2];
const SPACE_SENTENCE = `The Space cards offer's buttons (#208, "Space cards" above) follow this same gate.`;

function splitHunk(text, file) {
  const lines = text.split('\n');
  const a = lines.findIndex((l) => l.startsWith('<<<<<<< '));
  const b = lines.findIndex((l, i) => i > a && l === '=======');
  const c = lines.findIndex((l, i) => i > b && l.startsWith('>>>>>>> '));
  if (a < 0 || b < 0 || c < 0) throw new Error(`${file}: no complete conflict hunk`);
  if (lines.slice(c + 1).some((l) => /^(<<<<<<<|=======$|>>>>>>>)/.test(l)))
    throw new Error(`${file}: more than one hunk`);
  return { lines, a, b, c, head: lines.slice(a + 1, b), theirs: lines.slice(b + 1, c) };
}

// docs/09: the Space side's only change to the Remove bullet is one inserted sentence. Take the
// canvas side's line and put that sentence at the same place (after the disabled-reason clause).
{
  const file = `${repo}/docs/09-frontend-and-pwa.md`;
  const { lines, a, c, head, theirs } = splitHunk(readFileSync(file, 'utf8'), file);
  if (head.length !== 1 || theirs.length !== 1) throw new Error('docs/09: unexpected hunk shape');
  const anchor = `Nothing is replayed, prevented or patched; the store's refusal keeps its own disabled reason. `;
  if (theirs[0].split(anchor).length !== 2) throw new Error('docs/09: anchor not unique on canvas side');
  if (!head[0].includes(SPACE_SENTENCE)) throw new Error('docs/09: Space sentence missing on HEAD side');
  const merged = theirs[0].replace(anchor, `${anchor}${SPACE_SENTENCE} `);
  lines.splice(a, c - a + 1, merged);
  writeFileSync(file, lines.join('\n'));
}

// guide: keep the canvas side's two extra paragraphs and its "or move a card" / "drag" wording,
// and add the Space side's parenthetical about the stacked-cards panel's two buttons.
{
  const file = `${repo}/docs/guide/02-build-a-loop.md`;
  const { lines, a, c, head, theirs } = splitHunk(readFileSync(file, 'utf8'), file);
  const paren = ` (and, while it shows, the stacked-cards panel's **Space cards** and **Dismiss suggestion**)`;
  if (!head[0].includes(paren)) throw new Error('guide: parenthetical missing on HEAD side');
  const first = `Right after you pan the canvas or move a card by dragging with the mouse, **Remove connection** and **Reset route** are dimmed`;
  if (!theirs[0].startsWith(first)) throw new Error('guide: canvas side opening changed');
  const merged = [...theirs];
  merged[0] = theirs[0].replace(
    '**Remove connection** and **Reset route** are dimmed',
    `**Remove connection** and **Reset route**${paren} are dimmed`,
  );
  lines.splice(a, c - a + 1, ...merged);
  writeFileSync(file, lines.join('\n'));
}
console.log('resolved');
