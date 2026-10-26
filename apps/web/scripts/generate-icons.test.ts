import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { expect, it } from 'vitest';

it('generates two opaque RGBA PNGs at the required sizes and refuses a file destination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-icons-'));
  const run = (out: string) =>
    promisify(execFile)(
      process.execPath,
      [resolve(process.cwd(), 'scripts/generate-icons.mjs'), out],
      { timeout: 20_000, windowsHide: true },
    );
  try {
    const output = join(directory, 'icons');
    await run(output);
    for (const size of [192, 512]) {
      const png = await readFile(join(output, `icon-${size}.png`));
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expect([...png.subarray(24, 26)]).toEqual([8, 6]);
      const chunks: Buffer[] = [];
      for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        // Validate integrity with Node's independent implementation, not the generator's table.
        expect(png.readUInt32BE(offset + 8 + length)).toBe(
          crc32(png.subarray(offset + 4, offset + 8 + length)),
        );
        if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
          chunks.push(png.subarray(offset + 8, offset + 8 + length));
        offset += 12 + length;
      }
      const raw = inflateSync(Buffer.concat(chunks));
      expect(raw.length).toBe((size * 4 + 1) * size);
      const pixel = (x: number, y: number) => [
        ...raw.subarray(y * (size * 4 + 1) + 1 + x * 4, y * (size * 4 + 1) + 5 + x * 4),
      ];
      expect(pixel(0, 0)).toEqual([15, 23, 42, 255]);
      expect(pixel(size / 2, size / 2)).toEqual([34, 197, 94, 255]);
      expect(pixel(Math.round(size * 0.22), size / 2)).toEqual([226, 232, 240, 255]);
    }
    const blocked = join(directory, 'blocked');
    await writeFile(blocked, 'preserve');
    await expect(run(blocked)).rejects.toMatchObject({ code: 1 });
    expect(await readFile(blocked, 'utf8')).toBe('preserve');
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
});
