import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = 'C:/Users/98jak/.codex/worktrees/gg-20261117-probe-466/GraphGoblin';
const packet = fileURLToPath(new URL('.', import.meta.url));
const candidatePath = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/pr505-correction-root-snapshot-02/packages/adapter-codex/src/probe-directory.test.ts';
const expectedSource = 'e211bfdc49b1a465e4b1b0d997f028005112d003282417c7286172f928e15e75';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const input = readFileSync(candidatePath);
if (hash(input) !== expectedSource) throw new Error('Frozen maintained source changed');
const source = input.toString('utf8');
const generated = source
  .replace("from './index.js'", `from '${root}/packages/adapter-codex/src/index.ts'`)
  .replace("from './cli.js'", `from '${root}/packages/adapter-codex/src/cli.ts'`)
  .replace("new URL('./fixtures/readiness-cli.mjs', import.meta.url)", "new URL('./readiness-cli.mjs', import.meta.url)");
const roundTrip = generated
  .replace(`from '${root}/packages/adapter-codex/src/index.ts'`, "from './index.js'")
  .replace(`from '${root}/packages/adapter-codex/src/cli.ts'`, "from './cli.js'")
  .replace("new URL('./readiness-cli.mjs', import.meta.url)", "new URL('./fixtures/readiness-cli.mjs', import.meta.url)");
if (roundTrip !== source) throw new Error('Relocation changed behavior-bearing bytes');
const harness = join(packet, 'final-maintained-input');
mkdirSync(harness);
const fixture = readFileSync(join(root, 'packages/adapter-codex/src/fixtures/readiness-cli.mjs'));
writeFileSync(join(harness, 'probe-directory.test.ts'), generated, { flag: 'wx' });
writeFileSync(join(harness, 'readiness-cli.mjs'), fixture, { flag: 'wx' });
writeFileSync(join(harness, 'raw-frozen-probe-directory.test.ts.txt'), input, { flag: 'wx' });
const config = { root: harness.replaceAll('\\', '/'), resolve: { conditions: ['development'], alias: { vitest: root + '/packages/adapter-codex/node_modules/vitest/dist/index.js' } }, test: { include: ['*.test.ts'], environment: 'node', clearMocks: true, restoreMocks: true, pool: 'forks', execArgv: ['--expose-gc'] } };
writeFileSync(join(harness, 'vitest.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`, { flag: 'wx' });
const receipt = { candidatePath, candidateSha256: hash(input), generatedSha256: hash(generated), fixtureSha256: hash(fixture), roundTripExact: true, changes: ['relocated two imports and fixture URL only; all maintained bodies and assertions retained byte-for-byte', 'copied identical fake CLI bytes into disposable input directory'] };
writeFileSync(join(harness, 'generation.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt, null, 2));
