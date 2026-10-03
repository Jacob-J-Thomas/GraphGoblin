import { randomBytes } from 'node:crypto';
import type { ClockPort, IdPort } from '@graphgoblin/engine';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID generator: 48-bit millisecond timestamp plus 80 random bits, Crockford base32. */
export class UlidIds implements IdPort {
  constructor(private readonly clock: ClockPort = { now: () => new Date() }) {}

  next(): string {
    let time = this.clock.now().getTime();
    let timePart = '';
    for (let i = 0; i < 10; i += 1) {
      timePart = ALPHABET[time % 32] + timePart;
      time = Math.floor(time / 32);
    }
    const random = randomBytes(10);
    let randomPart = '';
    // 80 bits -> 16 characters of 5 bits each.
    let acc = 0;
    let bits = 0;
    for (const byte of random) {
      acc = (acc << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        randomPart += ALPHABET[(acc >> bits) & 31];
      }
    }
    return `${timePart}${randomPart}`.slice(0, 26);
  }
}
