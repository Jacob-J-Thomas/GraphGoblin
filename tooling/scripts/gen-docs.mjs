#!/usr/bin/env node
/**
 * Generate the reference docs: `docs/reference/nodes.md` from the node config schemas and
 * `docs/reference/api.md` from the OpenAPI document. With `--check`, regenerate in memory and fail
 * when a committed file differs (the `pnpm check:docs` gate).
 *
 * The node schemas are read from `packages/contracts/dist`, so the root scripts build contracts
 * first. The output is formatted with the repository's Prettier config so `format:check` agrees.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { renderApiReference } from './api-reference.mjs';
import { nodeFieldDocs, renderNodeReference } from './node-reference.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const contractsDist = join(root, 'packages', 'contracts', 'dist', 'index.js');
const contractsZod = join(root, 'packages', 'contracts', 'node_modules', 'zod', 'index.js');
const openApiPath = join(root, 'packages', 'api-client', 'openapi.json');

export const OUTPUTS = {
  nodes: join(root, 'docs', 'reference', 'nodes.md'),
  api: join(root, 'docs', 'reference', 'api.md'),
};

/**
 * From the built contracts package: the config JSON Schema per node kind (input side) and each
 * field's docs, read with the contracts' own `fieldMeta`.
 */
async function nodeConfigDocs() {
  if (!existsSync(contractsDist)) {
    throw new Error(
      'packages/contracts/dist is missing; run `pnpm --filter @graphgoblin/contracts build` first',
    );
  }
  const contracts = await import(pathToFileURL(contractsDist).href);
  const { z } = await import(pathToFileURL(contractsZod).href);
  const jsonSchemas = Object.fromEntries(
    Object.entries(contracts.NodeConfigSchemas).map(([kind, schema]) => [
      kind,
      z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
    ]),
  );
  return {
    jsonSchemas,
    fieldDocs: nodeFieldDocs(contracts.NodeConfigSchemas, contracts.fieldMeta),
  };
}

async function format(markdown, file) {
  const options = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(markdown, { ...options, filepath: file });
}

/** Render both references, formatted. Returns a map of output path to content. */
export async function generate() {
  const { jsonSchemas, fieldDocs } = await nodeConfigDocs();
  const nodes = renderNodeReference(jsonSchemas, fieldDocs);
  const api = renderApiReference(JSON.parse(readFileSync(openApiPath, 'utf8')));
  return {
    [OUTPUTS.nodes]: await format(nodes, OUTPUTS.nodes),
    [OUTPUTS.api]: await format(api, OUTPUTS.api),
  };
}

/** Paths whose committed content differs from `generated` (missing files count as different). */
export function staleFiles(generated, read = (path) => readFileSync(path, 'utf8')) {
  return Object.entries(generated)
    .filter(([path, content]) => {
      try {
        return read(path).replace(/\r\n/g, '\n') !== content;
      } catch {
        return true;
      }
    })
    .map(([path]) => path);
}

async function main(argv) {
  const generated = await generate();
  if (argv.includes('--check')) {
    const stale = staleFiles(generated);
    if (stale.length > 0) {
      console.error(
        `Generated docs are out of date: ${stale.map((p) => p.slice(root.length + 1)).join(', ')}.\nRun \`pnpm docs:generate\` and commit the result.`,
      );
      return 1;
    }
    console.warn('Generated docs are up to date.');
    return 0;
  }
  for (const [path, content] of Object.entries(generated)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    console.warn(`wrote ${path.slice(root.length + 1)}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    },
  );
}
