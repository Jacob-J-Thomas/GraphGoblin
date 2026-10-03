/**
 * Regenerate `openapi.json` and `src/generated/schema.d.ts` from the API's source.
 * Run with `pnpm --filter @graphgoblin/api-client generate`; no build is needed because tsx resolves
 * the `development` export condition.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { liveOpenApiDocument, OPENAPI_PATH, SCHEMA_PATH, typesFor } from './codegen.js';

const document = await liveOpenApiDocument();
await writeFile(OPENAPI_PATH, document, 'utf8');
await mkdir(dirname(SCHEMA_PATH), { recursive: true });
await writeFile(SCHEMA_PATH, await typesFor(document), 'utf8');
console.warn(`wrote ${OPENAPI_PATH}\nwrote ${SCHEMA_PATH}`);
