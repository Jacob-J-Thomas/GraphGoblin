import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [expectedSource, mode, frozenSourcePath, tag = ''] = process.argv.slice(2);
if (!/^[a-f0-9]{64}$/.test(expectedSource ?? '')) throw new Error('Expected source SHA-256 required');
if (!['ordinary', 'combined-early', 'combined-aborted'].includes(mode)) throw new Error('Unknown witness mode');
const root = 'C:/Users/98jak/.codex/worktrees/gg-20261117-probe-466/GraphGoblin';
const packet = fileURLToPath(new URL('.', import.meta.url));
if (!/^[a-z0-9-]*$/.test(tag)) throw new Error('Unsafe input tag');
const harness = join(packet, `${tag}${mode}-input`);
mkdirSync(harness);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const candidatePath = frozenSourcePath ?? join(root, 'packages/adapter-codex/src/probe-directory.test.ts');
const input = readFileSync(candidatePath);
if (hash(input) !== expectedSource) throw new Error('Frozen source changed');
const source = input.toString('utf8');
const directoryStart = source.indexOf("describe('Codex readiness probe directory'");
const lifecycleSignature = "describe('Codex readiness probe case lifecycle (#466)', () => {";
const lifecycleStart = source.indexOf(lifecycleSignature);
const lifecycleBody = lifecycleStart + lifecycleSignature.length;
const firstLifecycleTest = source.indexOf("  it.for(['before its first fake CLI starts'", lifecycleStart);
const ordinaryTitle = source.indexOf("'reports an ordinary case failure once, after the same settlement'", firstLifecycleTest);
const ordinaryStart = source.lastIndexOf('  it(', ordinaryTitle);
const combinedStart = source.indexOf("  it.for(['after its abort'", ordinaryTitle);
const combinedEnd = source.lastIndexOf('});');
if ([directoryStart, lifecycleStart, firstLifecycleTest, ordinaryTitle, ordinaryStart, combinedStart, combinedEnd].some((n) => n < 0)) {
  throw new Error('Source extraction boundary changed');
}
const helperOriginal = source.slice(0, directoryStart);
const helper = helperOriginal
  .replace("from './index.js'", `from '${root}/packages/adapter-codex/src/index.ts'`)
  .replace("from './cli.js'", `from '${root}/packages/adapter-codex/src/cli.ts'`)
  .replace("new URL('./fixtures/readiness-cli.mjs', import.meta.url)", "new URL('./readiness-cli.mjs', import.meta.url)")
  .replace("if (started.type === 'return') probe.children.push(started.value);", "if (started.type === 'return') { probe.children.push(started.value); observedChildren.push(started.value); record('owned-child-registered', { pid: started.value.pid }); }");
const definitions = source.slice(lifecycleBody, firstLifecycleTest);
const caseOriginal = mode === 'ordinary' ? source.slice(ordinaryStart, combinedStart) : source.slice(combinedStart, combinedEnd);
if (!caseOriginal.includes('lifecycleTest(async (lifecycle) => {')) throw new Error('Corrected maintained ownership wrapper missing');
let observed = caseOriginal
  .replace('lifecycleTest(async (lifecycle) => {', 'lifecycleTest(async (lifecycle) => {\n        try {')
  .replace('bodySettled = true;', "bodySettled = true; record('late-owned-body-settled');");
if (mode === 'ordinary') {
  const suffix = /\r?\n {4}\}\),\r?\n {2}\);\s*$/;
  if (!suffix.test(observed)) throw new Error('Ordinary maintained callback boundary changed');
  observed = observed.replace(suffix, "\n        } finally { finished = true; record('outer-owned-body-finished'); finishedSignal.resolve(); }\n    }),\n  );\n");
} else {
  const suffix = /\r?\n {6}\}\)\(context\),\r?\n {2}\);\s*$/;
  if (!suffix.test(observed)) throw new Error('Combined maintained callback boundary changed');
  observed = observed
    .replace("['after its abort', 'without an abort'] as const", mode === 'combined-early' ? "['without an abort'] as const" : "['after its abort'] as const")
    .replace('remove.mockRestore();', "remove.mockRestore(); localMockRestored = true; record('owned-rm-mock-restored');")
    .replace(suffix, "\n        } finally { finished = true; record('outer-owned-body-finished'); finishedSignal.resolve(); }\n      })(context),\n  );\n");
}
const observation = `
import { beforeEach, afterAll } from 'vitest';
import { appendFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const observedAt = performance.now();
const eventsPath = process.env.GG_466_QA_OBSERVATION!;
const originalTemp = Object.fromEntries(TEMP_NAMES.map((n) => [n, process.env[n]]));
const finishedSignal = Promise.withResolvers<void>();
const observedChildren: ChildProcess[] = [];
let finished = false;
let ownerRoot = '';
let delayed = false;
let successorStarted = false;
let actualAbortObserved = false;
let localMockRestored = ${mode === 'ordinary'};
let baselineRm: unknown;
let baselineReaddir: unknown;
const nativePresent = (pid: number | undefined) => {
  if (pid === undefined) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
};
const record = (event: string, more = {}) => appendFileSync(eventsPath, JSON.stringify({ event, elapsedMs: Math.round(performance.now() - observedAt), finished, successorStarted, ownerRoot, ...more }) + '\\n');
beforeEach(async (context) => {
  if (!context.task.name.startsWith('reports an ordinary') && !context.task.name.startsWith('reports a body failure')) return;
  baselineRm = vi.mocked(probeFs.rm).getMockImplementation();
  baselineReaddir = vi.mocked(probeFs.readdir).getMockImplementation();
  const realFs = await vi.importActual<typeof probeFs>('node:fs/promises');
  const actualAbort = Promise.withResolvers<void>();
  context.signal.addEventListener('abort', () => { actualAbortObserved = true; record('actual-outer-vitest-abort'); actualAbort.resolve(); }, { once: true });
  vi.mocked(probeFs.readdir).mockImplementationOnce(async (path) => {
    delayed = true;
    ownerRoot = dirname(String(path));
    record('held-real-readdir', { envStillOwned: TEMP_NAMES.every((n) => process.env[n] === ownerRoot) });
    const fallback = new AbortController();
    try {
      await Promise.race([
        actualAbort.promise.then(() => sleep(650)),
        sleep(9000, undefined, { signal: fallback.signal }).then(() => { throw new Error('Expected actual Vitest abort was not observed'); }),
      ]);
    } finally { fallback.abort(); }
    record('released-real-readdir');
    return realFs.readdir(path);
  });
});
`;
const successor = `
it('successor observes settled body, root, environment, mocks and native children', () => {
  successorStarted = true;
  const snapshot = {
    delayed, actualAbortObserved, finished, rootPresent: existsSync(ownerRoot),
    stubbedPriorTemp: TEMP_NAMES.filter((n) => process.env[n] === ownerRoot),
    envRestored: TEMP_NAMES.every((n) => process.env[n] === originalTemp[n]),
    localMockRestored,
    rmImplementationRestored: vi.mocked(probeFs.rm).getMockImplementation() === baselineRm,
    readdirImplementationRestored: vi.mocked(probeFs.readdir).getMockImplementation() === baselineReaddir,
    runningOwnedChildren: observedChildren.filter(isRunning).length,
    nativeOwnedChildren: observedChildren.map((child) => child.pid).filter(nativePresent),
  };
  record('successor-start', snapshot);
  expect(snapshot).toEqual({ delayed: true, actualAbortObserved: true, finished: true, rootPresent: false, stubbedPriorTemp: [], envRestored: true, localMockRestored: true, rmImplementationRestored: true, readdirImplementationRestored: true, runningOwnedChildren: 0, nativeOwnedChildren: [] });
});
afterAll(async () => {
  // As in the original witness, observation only after the successor has captured its first facts.
  await finishedSignal.promise;
  record('final-cleanup', { rootPresent: existsSync(ownerRoot), envRestored: TEMP_NAMES.every((n) => process.env[n] === originalTemp[n]) });
  expect(existsSync(ownerRoot)).toBe(false);
});
`;
const generated = helper + observation + "\ndescribe('maintained corrected lifecycle under its real outer deadline', () => {\n" + definitions + observed + successor + '\n});\n';
const fixture = readFileSync(join(root, 'packages/adapter-codex/src/fixtures/readiness-cli.mjs'));
writeFileSync(join(harness, 'outer-timeout.test.ts'), generated, { flag: 'wx' });
writeFileSync(join(harness, 'readiness-cli.mjs'), fixture, { flag: 'wx' });
const config = { root: harness.replaceAll('\\', '/'), resolve: { conditions: ['development'], alias: { vitest: root + '/packages/adapter-codex/node_modules/vitest/dist/index.js' } }, test: { include: ['*.test.ts'], environment: 'node', clearMocks: true, restoreMocks: true, pool: 'forks', execArgv: ['--expose-gc'] } };
writeFileSync(join(harness, 'vitest.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`, { flag: 'wx' });
writeFileSync(join(harness, 'extracted-maintained-case.ts.txt'), caseOriginal, { flag: 'wx' });
const generation = { mode, candidatePath, candidateSha256: hash(input), extractedCaseSha256: hash(caseOriginal), extractedDefinitionsSha256: hash(definitions), generatedSha256: hash(generated), fixtureSha256: hash(fixture), changes: ['relocated imports and copied identical fixture', 'retained corrected maintained lifecycle definitions and actual-context wiring', 'observation-only finally inside the maintained owned callback', 'observation-only child registration and local mock-restoration flag', 'held first real readdir until 650ms after actual unchanged 5000ms Vitest timeout', 'successor observes first facts synchronously before any await', ...(mode === 'ordinary' ? [] : ['selected one existing parameter row'])] };
writeFileSync(join(harness, 'generation.json'), JSON.stringify(generation, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(generation, null, 2));
