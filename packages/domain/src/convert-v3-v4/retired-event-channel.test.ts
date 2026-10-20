import { describe, expect, it } from 'vitest';
import { V3LoopDefinitionSchema } from '@graphgoblin/contracts';
import { convertDefinitionV3ToV4 } from './index.js';

describe('retired exit-to-Event chaining (#242, ADR-0042)', () => {
  it('refuses an old exit that publishes an Event, naming the destination', async () => {
    const result = await convertDefinitionV3ToV4(
      V3LoopDefinitionSchema.parse({
        schemaVersion: 3,
        name: 'emits',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: {
              return: {
                mapping: '1',
                channels: [{ kind: 'caller' }, { kind: 'event', eventType: 'loop-done' }],
              },
            },
          },
        ],
        edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'V4_DEFINITION_INVALID',
        path: '/nodes/1/config/destinations/1/kind',
      }),
    ]);
  });
});
