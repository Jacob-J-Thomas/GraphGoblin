/**
 * Drift gate: the committed OpenAPI document and generated types must match what the API emits
 * today. When this fails, run `pnpm --filter @graphgoblin/api-client generate` and commit.
 */
import { describe, expect, it } from 'vitest';
import { GENERATE_HINT, liveOpenApiDocument, readCommitted, typesFor } from '../scripts/codegen.js';

describe('generated client artefacts', () => {
  it('openapi.json and src/generated/schema.ts match the live API', async () => {
    const committed = await readCommitted();
    const live = await liveOpenApiDocument();
    expect(
      live === committed.document,
      `packages/api-client/openapi.json is out of date with the API: ${GENERATE_HINT} both files.`,
    ).toBe(true);
    const types = await typesFor(live);
    expect(
      types === committed.types,
      `packages/api-client/src/generated/schema.ts is out of date: ${GENERATE_HINT} both files.`,
    ).toBe(true);
  }, 120_000);
});
