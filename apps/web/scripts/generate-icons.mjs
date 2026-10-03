#!/usr/bin/env node
/**
 * Writes the PWA icons (public/icons/icon-192.png and icon-512.png) without any image dependency:
 * a slate square with a rounded green "node" and two port dots, encoded as an RGBA PNG with zlib.
 * Run with `node scripts/generate-icons.mjs` after changing the design; the output is committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'icons');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pixel(size, x, y) {
  const bg = [15, 23, 42, 255];
  const node = [34, 197, 94, 255];
  const port = [226, 232, 240, 255];
  const u = x / size;
  const v = y / size;
  const inBox = u > 0.22 && u < 0.78 && v > 0.3 && v < 0.7;
  const cornerR = 0.08;
  const cx = Math.min(Math.max(u, 0.22 + cornerR), 0.78 - cornerR);
  const cy = Math.min(Math.max(v, 0.3 + cornerR), 0.7 - cornerR);
  const rounded = Math.hypot(u - cx, v - cy) <= cornerR;
  const dot = (px, py) => Math.hypot(u - px, v - py) < 0.06;
  if (dot(0.22, 0.5) || dot(0.78, 0.5)) return port;
  if (inBox && rounded) return node;
  return bg;
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(size, x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(out, { recursive: true });
for (const size of [192, 512]) writeFileSync(join(out, `icon-${size}.png`), png(size));
console.error(`wrote icons to ${out}`);
