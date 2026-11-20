// QA helper (continuation, #434 dc65a24). Spin synchronously until <file> can be opened with an
// exclusive Windows share mode (libuv UV_FS_O_EXLOCK, share mode 0), then hold it until killed.
// Used to make the reset's own lock release fail natively, after the reset itself created the file.
// Usage: node spin-exlock.mjs <file> [timeoutMs]
// Prints {"ready":true} first, then {"held":true,"at":<epoch ms>} or {"held":false,"timeout":true}.
import { constants, openSync, writeSync } from 'node:fs';

const UV_FS_O_EXLOCK = 0x10000000; // libuv uv/win.h; not exported by node:fs constants
const [file, ms = '60000'] = process.argv.slice(2);
if (!file) {
  process.stderr.write('usage: spin-exlock.mjs <file> [timeoutMs]\n');
  process.exit(2);
}
const say = (obj) => writeSync(1, JSON.stringify({ pid: process.pid, ...obj }) + '\n');
say({ ready: true, mode: 'spin-exlock' });
const deadline = Date.now() + Number(ms);
let tries = 0;
let last;
for (;;) {
  tries++;
  try {
    openSync(file, constants.O_RDONLY | UV_FS_O_EXLOCK);
    say({ held: true, at: Date.now(), tries });
    setInterval(() => undefined, 1 << 30);
    break;
  } catch (error) {
    last = error && error.code;
    if (Date.now() > deadline) {
      say({ held: false, timeout: true, tries, last });
      process.exit(3);
    }
  }
}
