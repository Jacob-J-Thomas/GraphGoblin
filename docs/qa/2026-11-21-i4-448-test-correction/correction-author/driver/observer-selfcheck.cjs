'use strict';
const assert = require('node:assert/strict');
const net = require('node:net');
async function main() {
  await assert.rejects(fetch('http://127.0.0.1:11434/api/tags'), /D194 outbound fetch blocked/);
  assert.throws(() => net.connect({ host: '127.0.0.1', port: 11434 }), /D194 outbound socket blocked/);
  process.stdout.write('Observer selfcheck passed: one deliberate fetch and one socket attempt blocked before access.\n');
}
main().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
