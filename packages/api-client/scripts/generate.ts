/**
 * Regenerate `openapi.json` and `src/generated/schema.ts` from the API's source.
 * Run with `pnpm --filter @graphgoblin/api-client generate`; no build is needed because tsx resolves
 * the `development` export condition.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { liveOpenApiDocument, OPENAPI_PATH, SCHEMA_PATH, typesFor } from './codegen.js';

const destination = process.argv[2] ? resolve(process.argv[2]) : undefined;
const openapiPath = destination ? join(destination, 'openapi.json') : OPENAPI_PATH;
const schemaPath = destination ? join(destination, 'src/generated/schema.ts') : SCHEMA_PATH;
const document = await liveOpenApiDocument();
await mkdir(dirname(openapiPath), { recursive: true });
await writeFile(openapiPath, document, 'utf8');
await mkdir(dirname(schemaPath), { recursive: true });
await writeFile(schemaPath, await typesFor(document), 'utf8');
console.warn(`wrote ${openapiPath}\nwrote ${schemaPath}`);
