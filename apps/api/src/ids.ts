import { randomBytes } from 'node:crypto';
import type { ClockPort, IdPort } from '@graphgoblin/engine';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_LIMIT = 1n << 80n;

/** Process-local monotonic ULIDs: a 48-bit timestamp and an incrementing 80-bit random part. */
export class UlidIds implements IdPort {
  private lastTime = -1;
  private random = 0n;

  constructor(private readonly clock: ClockPort = { now: () => new Date() }) {}

  next(): string {
    // A clock adjustment must not reverse identities already minted by this generator.
    let time = Math.max(this.clock.now().getTime(), this.lastTime);
    if (time === this.lastTime) {
      this.random += 1n;
      if (this.random >= RANDOM_LIMIT) throw new Error('ULID random component exhausted.');
    } else {
      this.random = BigInt('0x' + randomBytes(10).toString('hex'));
    }
    this.lastTime = time;
    let timePart = '';
    for (let i = 0; i < 10; i += 1) {
      timePart = ALPHABET[time % 32] + timePart;
      time = Math.floor(time / 32);
    }
    let random = this.random;
    let randomPart = '';
    for (let i = 0; i < 16; i += 1) {
      randomPart = ALPHABET[Number(random & 31n)] + randomPart;
      random >>= 5n;
    }
    return timePart + randomPart;
  }
}
