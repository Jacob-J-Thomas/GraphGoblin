import { CURRENT_DEFINITION_FORMAT, type LoopDefinitionInput } from '@graphgoblin/contracts';

/** No providers: seed values, append and replace them, then exhaust a repeat gate. */
export function replaySeedLoop(name = 'Replay seed'): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'prepare',
        kind: 'mutate',
        label: 'Prepare',
        config: {
          operations: [
            { op: 'set', path: '/vars/history', value: { kind: 'literal', value: ['seed'] } },
            { op: 'set', path: '/vars/total', value: { kind: 'literal', value: 0 } },
            { op: 'append-message', role: 'user', content: 'Seed message' },
          ],
        },
      },
      {
        id: 'append',
        kind: 'mutate',
        label: 'Append',
        config: {
          operations: [
            { op: 'set', path: '/vars/history/-', value: { kind: 'literal', value: 'step' } },
            {
              op: 'set',
              path: '/vars/total',
              value: { kind: 'expression', jsonata: 'counters.nodeVisits.append' },
            },
            { op: 'set', path: '/vars/added', value: { kind: 'literal', value: 'present' } },
            { op: 'append-message', role: 'assistant', content: 'Appended' },
          ],
        },
      },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: '"repeat"',
          maxPasses: 3,
          routes: [
            { id: 'repeat', label: 'Repeat', repeat: true },
            { id: 'done', label: 'Done' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'vars' } },
    ],
    edges: [
      { id: 's', from: { node: 'start', port: 'out' }, to: { node: 'prepare' } },
      { id: 'p', from: { node: 'prepare', port: 'out' }, to: { node: 'append' } },
      { id: 'a', from: { node: 'append', port: 'out' }, to: { node: 'gate' } },
      { id: 'r', from: { node: 'gate', port: 'repeat' }, to: { node: 'append' } },
      { id: 'd', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'l', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'done' } },
    ],
  };
}
