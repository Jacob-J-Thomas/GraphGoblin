import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const p = 'docs/qa/2026-10-22-wp-f2b-qa/round-4/';
const changelog = await readFile('CHANGELOG.md', 'utf8');
const bullet = changelog.split('\n').find((s) => s.endsWith('(#204)'));
const spec = JSON.parse(await readFile('packages/api-client/openapi.json', 'utf8'));
const entry =
  spec.paths['/model-catalog'].get.responses['200'].content['application/json'].schema.properties
    .items.items;
const generated = await readFile('packages/api-client/src/generated/schema.ts', 'utf8');
const route = await readFile('apps/api/src/routes/settings.ts', 'utf8');
const checks = {
  upgradeNote: bullet.includes('**Upgrade:**'),
  apiAndWebTogether: /rebuild the API and web app together/.test(bullet),
  regeneratedClientNamed: /regenerated client/.test(bullet),
  noStoreChange: /No store migration or reset is needed/.test(bullet),
  generatedNonOptionalBoolean:
    /ecosystemDefault: boolean;/.test(generated) && !/ecosystemDefault\?:/.test(generated),
  openApiRequired: entry.required.includes('ecosystemDefault'),
  openApiBoolean: entry.properties.ecosystemDefault.type === 'boolean',
  apiResponseSchemaBoolean: route.includes('ecosystemDefault: z.boolean()'),
};
await writeFile(
  p + 'documentation-check.json',
  JSON.stringify(
    {
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      steps:
        'Compare #204 Upgrade note with generated GET /model-catalog entry and API response schema; no execution or migration claimed by this source check.',
      expected:
        'Rebuild API and web together with regenerated required response field; no store migration/reset.',
      bullet,
      sourceFiles: [
        'CHANGELOG.md',
        'packages/api-client/src/generated/schema.ts',
        'packages/api-client/openapi.json',
        'apps/api/src/routes/settings.ts',
      ],
      checks,
      verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(checks));
