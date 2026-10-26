// Loop definitions used by the acceptance probes (format 4, public API shapes).
import { edge_ } from './lib.mjs';

export const manual = (label = 'Start') => ({ id: 'start', kind: 'trigger', label, config: { type: 'manual' } });

/**
 * A cyclic loop: `grow` increments vars.n (and optionally writes a large string), a gate repeats
 * until vars.n reaches `passes`. Every pass appends node.started/node.finished/decision events.
 */
export function cycle({ name, passes, blobChars = 0, maxNodeVisits = null }) {
  const operations = [
    { op: 'set', path: '/vars/n', value: { kind: 'expression', jsonata: '($exists(vars.n) ? vars.n : 0) + 1' } },
  ];
  if (blobChars > 0) {
    operations.push({
      op: 'set',
      path: '/vars/blob',
      value: { kind: 'expression', jsonata: `$pad("", ${blobChars}, "x")` },
    });
  }
  return {
    schemaVersion: 4,
    name,
    settings: { maxNodeVisits },
    nodes: [
      manual(),
      { id: 'grow', kind: 'mutate', label: 'Grow', config: { operations } },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: `vars.n < ${passes} ? "again" : "done"`,
          maxPasses: null,
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'done', label: 'Done' },
          ],
        },
      },
      { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: 'vars.n' } },
    ],
    edges: [
      edge_('start', 'out', 'grow'),
      edge_('grow', 'out', 'gate'),
      edge_('gate', 'again', 'grow'),
      edge_('gate', 'done', 'finish'),
      edge_('gate', 'limit-reached', 'finish'),
    ],
  };
}
