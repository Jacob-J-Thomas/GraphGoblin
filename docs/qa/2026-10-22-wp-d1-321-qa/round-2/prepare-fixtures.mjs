// QA copies only. <repo> production source and assertions remain unchanged.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const out = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const relativeRoot = '../../../../';
let browser = await fs.readFile(join(repo, 'apps/web/e2e/script-recovery.browser.ts'), 'utf8');
browser = browser
  .replaceAll('5910', '5920')
  .replaceAll('5919', '5929')
  .replaceAll('gg-wp-d1-browser-', 'gg-qa-321-r2-browser-')
  .replace(
    "from '@playwright/test'",
    `from '${relativeRoot}apps/web/node_modules/@playwright/test/index.mjs'`,
  )
  .replace(
    "from '@graphgoblin/contracts'",
    `from '${relativeRoot}packages/contracts/dist/index.js'`,
  )
  .replace(
    "new URL('../../api/', import.meta.url)",
    `new URL('${relativeRoot}apps/api/', import.meta.url)`,
  )
  .replace(
    "new URL('../dist/', import.meta.url)",
    `new URL('${relativeRoot}apps/web/dist/', import.meta.url)`,
  );
const begin = browser.indexOf('    await page.screenshot({');
const end = browser.indexOf('    await dialog.getByRole', begin);
if (begin < 0 || end < 0) throw new Error('Expected browser artifact call missing');
browser =
  browser.slice(0, begin) +
  "    await writeFile(new URL('./standalone-edge-dialog.txt', import.meta.url), await dialog.innerText());\n" +
  browser.slice(end);
await fs.writeFile(join(out, 'script-recovery.browser.ts'), browser);
await fs.writeFile(
  join(out, 'playwright.script-recovery.config.ts'),
  `import { defineConfig } from '${relativeRoot}apps/web/node_modules/@playwright/test/index.mjs';
export default defineConfig({testDir:'.',testMatch:'script-recovery.browser.ts',workers:1,retries:0,timeout:180000,expect:{timeout:15000},outputDir:'standalone-edge-results',reporter:'line',use:{channel:'msedge',headless:true,viewport:{width:1440,height:1000}}});\n`,
);
let recovery = await fs.readFile(
  join(repo, 'apps/api/scripts/recovery-process.integration.mjs'),
  'utf8',
);
recovery = recovery
  .replaceAll('5600', '5920')
  .replaceAll('5699', '5929')
  .replaceAll('gg-recovery-process-', 'gg-qa-321-r2-recovery-')
  .replace(
    "const root = fileURLToPath(new URL('../../../', import.meta.url));",
    `const root = fileURLToPath(new URL('${relativeRoot}', import.meta.url));`,
  )
  .replaceAll("'@graphgoblin/contracts'", `'${relativeRoot}packages/contracts/dist/index.js'`)
  .replaceAll(
    "'@graphgoblin/engine/testing'",
    `'${relativeRoot}packages/engine/dist/testing/index.js'`,
  )
  .replaceAll("'@graphgoblin/engine'", `'${relativeRoot}packages/engine/dist/index.js'`)
  .replaceAll(
    "'@graphgoblin/infrastructure/sqlite'",
    `'${relativeRoot}packages/infrastructure/dist/sqlite/index.js'`,
  );
await fs.writeFile(join(out, 'recovery-process.integration.mjs'), recovery);
await fs.writeFile(
  join(out, 'retarget.mjs'),
  `// Transform test resource locations only; never production code.
export const retarget = {name:'qa-resource-targets',enforce:'pre',transform(code,id){if(!/\\.test\\.tsx?$|api-subprocess\\.ts$|global-setup\\.ts$/.test(id.split('?')[0]))return;return code.replaceAll("'gg-","'gg-qa-321-r2-").replaceAll('[5910, 5919]','[5920, 5929]').replaceAll('[5600, 5699]','[5920, 5929]');}};\n`,
);
for (const [name, path] of [
  ['api', 'apps/api'],
  ['infrastructure', 'packages/infrastructure'],
]) {
  await fs.writeFile(
    join(out, `${name}.config.mts`),
    `import original from '${relativeRoot}${path}/vitest.config.ts';\nimport { retarget } from './retarget.mjs';\nexport default {...original,plugins:[...(original.plugins??[]),retarget]};\n`,
  );
}
await fs.writeFile(
  join(out, 'client-contract.ts'),
  `import type { RunSnapshot } from '@graphgoblin/api-client';
export function provenance(run: RunSnapshot) {
 const script = run.failure?.script;
 const visitId: string|undefined = script?.visitId;
 const dispatchId: string|undefined = script?.dispatchId;
 const exitCode: number|undefined = script?.exitCode;
 const state: 'definitely-not-started'|'outcome-uncertain'|'completed'|undefined = script?.state;
 return {visitId,dispatchId,exitCode,state};
}\n`,
);
await fs.writeFile(
  join(out, 'client-config.json'),
  JSON.stringify(
    {
      compilerOptions: {
        noEmit: true,
        strict: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        skipLibCheck: true,
        paths: {
          '@graphgoblin/api-client': [
            `${relativeRoot}apps/web/node_modules/@graphgoblin/api-client/dist/index.d.ts`,
          ],
        },
      },
      files: ['client-contract.ts'],
    },
    null,
    2,
  ),
);
process.stdout.write(
  'Prepared isolated fixtures, text browser capture, and public client compile probe.\n',
);
