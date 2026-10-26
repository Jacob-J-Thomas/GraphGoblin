// Public Vitest CLI parser only; does not execute any tests.
import fs from 'node:fs/promises';
import { parseCLI, resolveConfig } from '../../../../apps/api/node_modules/vitest/dist/node.js';
const config = '../../docs/qa/2026-10-22-wp-d1-321-qa/round-3/qa.config.mts';
const requested = parseCLI(`vitest run --coverage -- --maxWorkers=2 --config=${config}`);
const direct = parseCLI(`vitest run --coverage --maxWorkers=2 --config=${config}`);
const defaults = await resolveConfig({ pool: 'forks' });
const result = {
  method: 'Public parseCLI and resolveConfig exports; no test execution.',
  requested: {
    filter: requested.filter,
    maxWorkers: requested.options.maxWorkers ?? null,
    config: requested.options.config ?? null,
  },
  withoutExtraSeparator: {
    filter: direct.filter,
    maxWorkers: direct.options.maxWorkers ?? null,
    config: direct.options.config ?? null,
  },
  resolvedDefaultMaxWorkers: defaults.maxWorkers ?? null,
};
await fs.writeFile(
  new URL('cli-parsing.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(result) + '\n');
