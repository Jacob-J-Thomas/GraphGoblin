import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_PREFIXES } from './prefixes.js';

const openApiDocument = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../packages/api-client/openapi.json'), 'utf8'),
) as { paths: Record<string, unknown> };

describe('API proxy prefixes', () => {
  it('includes every top-level OpenAPI path prefix and the OpenAPI document route', () => {
    const prefixes = new Set(
      Object.keys(openApiDocument.paths).map((path) => {
        const prefix = path.match(/^\/[^/]+/)?.[0];
        if (!prefix) throw new Error(`OpenAPI path has no top-level prefix: ${path}`);
        return prefix;
      }),
    );
    prefixes.add('/openapi.json');

    expect(API_PREFIXES).toEqual(expect.arrayContaining([...prefixes]));
  });
});
