import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedSource = process.argv[2];
if (!/^[a-f0-9]{64}$/.test(expectedSource ?? '')) throw new Error('Expected source SHA-256 required');
const root = 'C:/Users/98jak/.codex/worktrees/gg-20261117-probe-466/GraphGoblin';
const packet = fileURLToPath(new URL('.', import.meta.url));
const tag = process.argv[4] ?? '';
if (!/^[a-z0-9-]*$/.test(tag)) throw new Error('Unsafe input tag');
const harness = join(packet, `${tag}helper-timeout-input`);
mkdirSync(harness);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const candidatePath = process.argv[3] ?? join(root, 'packages/adapter-codex/src/probe-directory.test.ts');
const input = readFileSync(candidatePath);
if (digest(input) !== expectedSource) throw new Error('Frozen source changed');
const source = input.toString('utf8');
const division = "describe('Codex readiness probe directory', () => {";
const index = source.indexOf(division);
if (index < 0 || index !== source.lastIndexOf(division)) throw new Error('Helper boundary changed');
const helperOriginal = source.slice(0, index);
const helper = helperOriginal
  .replace("from './index.js'", `from '${root}/packages/adapter-codex/src/index.ts'`)
  .replace("from './cli.js'", `from '${root}/packages/adapter-codex/src/cli.ts'`)
  .replace("new URL('./fixtures/readiness-cli.mjs', import.meta.url)", "new URL('./readiness-cli.mjs', import.meta.url)");
const appendix = readFileSync(join(packet, 'previous-independent-qa-cases.ts.txt'));
if (digest(appendix) !== '646e5861c25efdc1783f9b0f00c4f313106f95f83acdc0a23116fb7a20c4c98f') {
  throw new Error('Preserved independent helper QA input changed');
}
const fixture = readFileSync(join(root, 'packages/adapter-codex/src/fixtures/readiness-cli.mjs'));
const generated = Buffer.concat([Buffer.from(helper), appendix]);
writeFileSync(join(harness, 'helper-timeout.test.ts'), generated, { flag: 'wx' });
writeFileSync(join(harness, 'readiness-cli.mjs'), fixture, { flag: 'wx' });
const config = {
  root: harness.replaceAll('\\', '/'),
  resolve: { conditions: ['development'], alias: { vitest: root + '/packages/adapter-codex/node_modules/vitest/dist/index.js' } },
  test: { include: ['*.test.ts'], environment: 'node', clearMocks: true, restoreMocks: true, pool: 'forks', execArgv: ['--expose-gc'] },
};
writeFileSync(join(harness, 'vitest.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`, { flag: 'wx' });
const receipt = {
  candidatePath,
  candidateSha256: digest(input),
  originalHelperSha256: digest(helperOriginal),
  preservedQaBodySha256: digest(appendix),
  generatedSha256: digest(generated),
  fixtureSha256: digest(fixture),
  changes: ['copied frozen helper verbatim except relocated imports and fixture URL', 'copied unchanged prior independent runtime QA input', 'copied identical fake CLI bytes into disposable input directory'],
};
writeFileSync(join(harness, 'generation.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt, null, 2));
