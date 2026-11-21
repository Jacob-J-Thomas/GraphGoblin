// Applies one named mutation to PreflightSection.tsx; every replacement must match exactly once.
// Usage: node mutate.mjs <file> <mutation-id>. Restoration is done by the caller from a backup.
import { readFileSync, writeFileSync } from 'node:fs';

const [file, id] = process.argv.slice(2);
const GATE = "{p.harness === 'codex' ? <CodexPreflight /> : null}";
const PARAGRAPH = '<p className="text-xs text-muted">\n      {CODEX_PLUGIN_OBSERVABILITY_NOTICE';
const PROBLEMS_START = '                {p.problems.length > 0 ? (';

const MUTATIONS = {
  // The notice is never rendered.
  'M1-no-notice': [[GATE, '{null}']],
  // Every harness row gets the Codex notice.
  'M2-every-harness': [[GATE, '<CodexPreflight />']],
  // Only a ready Codex row gets it (backend-style gating).
  'M3-ready-only': [[GATE, "{p.harness === 'codex' && p.ok ? <CodexPreflight /> : null}"]],
  // The notice takes the warning tone instead of muted information.
  'M4-warn-tone': [
    [PARAGRAPH, PARAGRAPH.replace('text-muted', 'text-status-warn-fg')],
  ],
  // The notice becomes a second live region.
  'M5-live-region': [[PARAGRAPH, PARAGRAPH.replace('<p ', '<p role="status" ')]],
  // Commands are not set as code.
  'M6-no-code': [['i % 2 === 1 ? <code key={i}>{part}</code> : part', 'part']],
  // The notice is visually hidden.
  'M7-visually-hidden': [[PARAGRAPH, PARAGRAPH.replace('text-muted', 'text-muted sr-only')]],
  // The notice is placed before the problem list.
  'M8-before-problems': [
    [`\n                ${GATE}`, ''],
    [PROBLEMS_START, `                ${GATE}\n${PROBLEMS_START}`],
  ],
  // The words drift from the shared constant.
  'M9-copy-drift': [
    [
      'CODEX_PLUGIN_OBSERVABILITY_NOTICE.split(',
      "CODEX_PLUGIN_OBSERVABILITY_NOTICE.replace('not verified', 'not checked').split(",
    ],
  ],
};

const steps = MUTATIONS[id];
if (!steps) throw new Error(`unknown mutation ${id}`);
let text = readFileSync(file, 'utf8');
for (const [from, to] of steps) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${id}: expected one match for ${JSON.stringify(from)}, got ${count}`);
  text = text.replace(from, () => to);
}
writeFileSync(file, text);
console.log(`${id}: applied ${steps.length} replacement(s)`);
