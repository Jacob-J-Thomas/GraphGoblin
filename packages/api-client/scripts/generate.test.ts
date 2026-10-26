import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { liveOpenApiDocument, typesFor } from './codegen.js';

async function generate(destination: string) {
  const previous = process.argv;
  process.argv = [process.execPath, 'generate.ts', destination];
  try {
    vi.resetModules();
    await import('./generate.js');
  } finally {
    process.argv = previous;
  }
}

it('generates byte-identical OpenAPI and types in a disposable destination; refuses a file destination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-codegen-'));
  const output = join(directory, 'generated');
  await generate(output);
  const document = await liveOpenApiDocument();
  expect(await readFile(join(output, 'openapi.json'), 'utf8')).toBe(document);
  expect(await readFile(join(output, 'src/generated/schema.ts'), 'utf8')).toBe(
    await typesFor(document),
  );
  const blocked = join(directory, 'blocked');
  await writeFile(blocked, 'preserve');
  await expect(generate(blocked)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(blocked, 'utf8')).toBe('preserve');
  await expect(typesFor('not-json')).rejects.toBeInstanceOf(SyntaxError);
}, 60_000);
