import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const here = new URL('.', import.meta.url),
  root = new URL('../../../../', here);
const files = [
  'apps/web/src/api/readiness.ts',
  'apps/web/src/api/queries.ts',
  'packages/infrastructure/src/claude/harness.ts',
  'packages/domain/src/readiness.ts',
];
const compared = [];
for (const file of files) {
  try {
    const current = (await readFile(new URL(file, root), 'utf8')).replaceAll('\r\n', '\n');
    const parent = execFileSync(
      'git',
      ['show', 'e41008dbbaaa65e4e702226e39909fb0718ecba6:' + file],
      { encoding: 'utf8', windowsHide: true },
    ).replaceAll('\r\n', '\n');
    compared.push({
      file,
      equal: current === parent,
      currentSha256: createHash('sha256').update(current).digest('hex'),
      parentSha256: createHash('sha256').update(parent).digest('hex'),
    });
  } catch (e) {
    compared.push({ file, error: e.code ?? e.message });
  }
}
const change = (await readFile(new URL('CHANGELOG.md', root), 'utf8'))
  .split('\n')
  .find((x) => x.endsWith('(#204)'));
const client = (
  await readFile(new URL('packages/api-client/src/generated/schema.ts', root), 'utf8')
)
  .split('\n')
  .find((x) => x.includes('ecosystemDefault:'))
  ?.trim();
await writeFile(
  new URL('merge-source-check.json', here),
  JSON.stringify(
    {
      head: '86e96bbc7f99a65cbf26d6feb7fb9fc0b2f61f60',
      mergeParent: 'e41008dbbaaa65e4e702226e39909fb0718ecba6',
      lineEndingsNormalized: true,
      compared,
      upgradeBullet: change,
      generatedClientField: client,
      note: 'Source evidence only, complementary to current served and unit results.',
    },
    null,
    2,
  ) + '\n',
);
console.log(compared.map((x) => ({ file: x.file, equal: x.equal, error: x.error })));
