import { describe, expect, it } from 'vitest';
import { portWidthLimits } from './port-targets.js';
import type { RoutingNode } from './routing.js';

const card = (id: string, x: number, y = 0): RoutingNode => ({
  id,
  x,
  y,
  width: 184,
  height: 232,
  input: { x: x - 6, y: y + 116 },
  outputs: { yes: { x: x + 190, y: y + 115 }, no: { x: x + 190, y: y + 161 } },
});

describe('touch port width limits', () => {
  it('shares the 76 px gap between cards 260 px apart without overlapping their hit boxes', () => {
    const limits = portWidthLimits([card('a', 0), card('b', 260)]);
    expect(limits.get('a')!.outputs['yes']).toBe(38);
    expect(limits.get('b')!.input).toBe(38);
    expect(184 + limits.get('a')!.outputs['yes']! / 2).toBeLessThan(
      260 - limits.get('b')!.input! / 2,
    );
  });

  it('does not constrain targets with the own card or a card outside the vertical hit strip', () => {
    const limits = portWidthLimits([card('a', 0), card('below', 200, 240)]);
    expect(limits.get('a')).toEqual({ input: 88.03125, outputs: { yes: 88.03125, no: 88.03125 } });
  });

  it('limits each output separately and uses the nearest of several cards', () => {
    const short = { ...card('b', 300, 100), height: 30 };
    const limits = portWidthLimits([card('a', 0), short, card('c', 260, 100)]);
    expect(limits.get('a')!.outputs).toEqual({ yes: 38, no: 38 });
    expect(portWidthLimits([card('a', 0), short]).get('a')!.outputs).toEqual({
      yes: 58,
      no: 88.03125,
    });
  });

  it('does not extend a hit box into a card covering its port', () => {
    const limits = portWidthLimits([card('a', 0), card('cover', 180)]);
    expect(limits.get('a')!.outputs['yes']).toBe(0);
    expect(limits.get('cover')!.input).toBe(0);
  });

  it('supports triggers without inputs and exits without outputs', () => {
    const trigger = card('start', 0);
    delete trigger.input;
    expect(
      portWidthLimits([trigger, { ...card('done', 600), outputs: {} }]).get('start')!.input,
    ).toBeUndefined();
    expect(portWidthLimits([]).size).toBe(0);
  });
});
