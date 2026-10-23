import { describe, expect, it } from 'vitest';
import { UlidSchema } from '@graphgoblin/contracts';
import { FakeClock } from '@graphgoblin/engine/testing';
import { UlidIds } from './ids.js';

describe('UlidIds', () => {
  it('strictly increases within one millisecond, including random-component carries', () => {
    const ids = new UlidIds(new FakeClock());
    let previous = ids.next();
    for (let i = 0; i < 1024; i++) {
      const next = ids.next();
      expect(next > previous, `ID ${i + 1} must follow the previous ID`).toBe(true);
      expect(UlidSchema.safeParse(next).success).toBe(true);
      expect(next.slice(0, 10)).toBe(previous.slice(0, 10));
      previous = next;
    }
  });
  it('increases when time advances and does not reverse when the clock moves backwards', () => {
    const clock = new FakeClock();
    const ids = new UlidIds(clock);
    const first = ids.next();
    clock.advance(1);
    const next = ids.next();
    expect(next > first).toBe(true);
    expect(next.slice(0, 10) > first.slice(0, 10)).toBe(true);
    clock.advance(-1);
    expect(ids.next() > next).toBe(true);
    expect(UlidSchema.safeParse(new UlidIds().next()).success).toBe(true);
  });
});
