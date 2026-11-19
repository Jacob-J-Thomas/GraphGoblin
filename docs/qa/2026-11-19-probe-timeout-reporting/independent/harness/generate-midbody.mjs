import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const scratch = 'D:/GraphGoblin-QA/2026-11-18/pr505-midbody-dedup-independent-qa-02';
const oldBinding = JSON.parse(readFileSync(join(root, 'baseline-binding.json')));
const sourceRoot = oldBinding.sourceRoot.replaceAll('\\', '/');
const requireDependency = createRequire(oldBinding.dependencyRoot + '/package.json');
const ts = requireDependency('typescript');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const generations = [];
for (const binding of JSON.parse(readFileSync(process.argv[2] ?? join(root, 'candidate-source-binding.json')))) {
for (const variant of ['original-reason', 'distinct-error']) {
  const input = readFileSync(binding.sourcePath);
  if (hash(input) !== binding.sourceSha256) throw new Error('Source drift');
  const source = input.toString('utf8');
  const file = ts.createSourceFile('source.test.ts', source, ts.ScriptTarget.Latest, true);
  const suites = file.statements.filter(ts.isExpressionStatement).map((node) => node.expression).filter(ts.isCallExpression).filter((node) => node.expression.getText(file) === 'describe');
  const direct = suites.find((node) => node.arguments[0].text === 'Codex readiness probe directory');
  const lifecycle = suites.find((node) => node.arguments[0].text === 'Codex readiness probe case lifecycle (#466)');
  const statements = lifecycle.arguments[1].body.statements;
  const isTest = (node) => ts.isExpressionStatement(node) && /^it(?:\.|\()/.test(node.getText(file));
  const definitions = statements.filter((node) => !isTest(node)).map((node) => node.getFullText(file)).join('');
  const target = statements.find((node) => node.getText(file).includes("'reports a body failure %s once, and a failed case-root removal, after the same settlement'"));
  const rawCase = target.getFullText(file);
  const callbackNeedle = 'lifecycleTest(async (lifecycle) => {';
  const waitNeedle = "const { rm } = await vi.importActual<typeof probeFs>('node:fs/promises');";
  if (!rawCase.includes(callbackNeedle) || !rawCase.includes(waitNeedle)) throw new Error('Precise maintained boundary changed');
  let observedCase = rawCase
    .replace("['after its abort', 'without an abort'] as const", "['without an abort'] as const")
    .replace(callbackNeedle, callbackNeedle + '\n        try {')
    .replace(waitNeedle, "const { rm } = await qaHoldActual(vi.importActual<typeof probeFs>('node:fs/promises'), lifecycle.context.signal);")
    .replace("const remove = vi.spyOn(probeFs, 'rm');", "const remove = vi.spyOn(probeFs, 'rm'); qaFaultMockInstalled = true; qaRecord('local-rm-fault-installed');")
    .replace('remove.mockRestore();', "remove.mockRestore(); qaLocalMockRestored = true; qaRecord('local-rm-mock-restored');");
  const suffix = /\r?\n {6}\}\)\(context\),\r?\n {2}\);\s*$/;
  if (!suffix.test(observedCase)) throw new Error('Owned outer callback boundary changed');
  observedCase = observedCase.replace(suffix, "\n        } finally { qaOuterFinished = true; qaRecord('outer-owned-body-finished'); }\n      })(context),\n  );\n");
  const helper = source.slice(0, direct.parent.getFullStart())
    .replace("from './index.js'", `from '${sourceRoot}/packages/adapter-codex/src/index.ts'`)
    .replace("from './cli.js'", `from '${sourceRoot}/packages/adapter-codex/src/cli.ts'`)
    .replace("new URL('./fixtures/readiness-cli.mjs', import.meta.url)", `new URL('file:///${sourceRoot}/packages/adapter-codex/src/fixtures/readiness-cli.mjs')`)
    .replace('root = await probeFs.mkdtemp(join(tmpdir(), prefix));', "root = await probeFs.mkdtemp(join(tmpdir(), prefix)); qaRoots.push(root); qaRecord('case-root-created', { root, signalAborted: context.signal.aborted });")
    .replace("if (started.type === 'return') probe.children.push(started.value);", "if (started.type === 'return') { probe.children.push(started.value); qaChildren.push(started.value); qaRecord('owned-child-created', { pid: started.value.pid }); }");
  const observation = `
import { beforeEach } from 'vitest';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { setTimeout as qaSleep } from 'node:timers/promises';
const qaVariant = ${JSON.stringify(variant)};
const qaStart = performance.now();
const qaEvents = process.env.GG505_OUTPUT + '/events.jsonl';
const qaRoots: string[] = [];
const qaChildren: ChildProcess[] = [];
const qaOriginalTemp = Object.fromEntries(TEMP_NAMES.map((name) => [name, process.env[name]]));
const qaAborted = Promise.withResolvers<void>();
let qaOuterSignal: AbortSignal;
let qaOuterFinished = false;
let qaLocalMockRestored = false;
let qaFaultMockInstalled = false;
let qaInitialRmImplementation: unknown;
let qaRunnerEntries: string[] = [];
function qaRecord(event: string, more = {}) { appendFileSync(qaEvents, JSON.stringify({ event, elapsedMs: Math.round(performance.now() - qaStart), ...more }) + '\\n'); }
beforeEach((context) => {
  if (!context.task.name.startsWith('reports a body failure')) return;
  qaOuterSignal = context.signal;
  qaInitialRmImplementation = vi.mocked(probeFs.rm).getMockImplementation();
  qaRunnerEntries = readdirSync(process.env.TEMP!);
  context.signal.addEventListener('abort', () => {
    const reason = context.signal.reason;
    qaRecord('actual-outer-abort', { name: reason.name, message: reason.message, stack: reason.stack });
    qaAborted.resolve();
  }, { once: true });
});
async function qaHoldActual<T>(operation: Promise<T>, inner: AbortSignal): Promise<T> {
  const began = performance.now();
  const value = await operation;
  qaRecord('real-importActual-resolved', { actualImportDurationMs: performance.now() - began, outerAborted: qaOuterSignal.aborted });
  const fallback = new AbortController();
  try { await Promise.race([qaAborted.promise.then(() => qaSleep(650)), qaSleep(9000, undefined, { signal: fallback.signal }).then(() => { throw new Error('Expected real default timeout was not observed'); })]); }
  finally { fallback.abort(); }
  qaRecord('released-import-result', { outerAborted: qaOuterSignal.aborted, innerAborted: inner.aborted, sameReasonObject: inner.reason === qaOuterSignal.reason });
  if (qaVariant === 'distinct-error') {
    const original = qaOuterSignal.reason;
    const distinct = new Error(original.message);
    distinct.name = original.name;
    distinct.stack = original.stack;
    qaRecord('distinct-error-created', { sameObject: distinct === original, sameMessage: distinct.message === original.message, sameStack: distinct.stack === original.stack });
    throw distinct;
  }
  return value;
}
`;
  const successor = `
it('successor observes settled state without repairing it', () => {
  const snapshot = {
    outerFinished: qaOuterFinished, localMockRestored: qaLocalMockRestored, faultMockInstalled: qaFaultMockInstalled, localMockRestoredOrNotInstalled: !qaFaultMockInstalled || qaLocalMockRestored,
    rootsCreated: qaRoots.length, rootsStillPresent: qaRoots.filter((root) => existsSync(root)),
    childrenCreated: qaChildren.length, livingOwnedChildren: qaChildren.filter(isRunning).length,
    envRestored: TEMP_NAMES.every((name) => process.env[name] === qaOriginalTemp[name]),
    rmImplementationRestored: vi.mocked(probeFs.rm).getMockImplementation() === qaInitialRmImplementation,
    runnerEntriesUnchanged: JSON.stringify(readdirSync(qaOriginalTemp.TEMP!)) === JSON.stringify(qaRunnerEntries),
  };
  qaRecord('successor-first-observation', snapshot);
  expect(snapshot).toMatchObject({ outerFinished: true, localMockRestoredOrNotInstalled: true, rootsStillPresent: [], childrenCreated: 0, livingOwnedChildren: 0, envRestored: true, rmImplementationRestored: true, runnerEntriesUnchanged: true });
});
`;
  const generated = helper + observation + "\ndescribe('one maintained combined-fault row at its first real import wait', () => {\n" + definitions + observedCase + successor + '\n});\n';
  const directory = join(scratch, binding.label + '-' + variant + '-input');
  mkdirSync(directory, { recursive: true });
  const config = { root: directory, cacheDir: join(scratch, 'cache', binding.label), server: { fs: { allow: [scratch, oldBinding.sourceRoot, oldBinding.dependencyRoot] } }, resolve: { conditions: ['development'], alias: oldBinding.aliases }, test: { include: ['*.test.ts'], environment: 'node', clearMocks: true, restoreMocks: true, pool: 'forks', execArgv: ['--expose-gc'] } };
  writeFileSync(join(directory, 'case.test.ts'), generated, { flag: 'wx' });
  writeFileSync(join(directory, 'extracted-maintained-case.ts.txt'), rawCase, { flag: 'wx' });
  writeFileSync(join(directory, 'vitest.config.mjs'), 'export default ' + JSON.stringify(config, null, 2) + ';\n', { flag: 'wx' });
  const meta = { mode: 'midbody-' + variant, variant, sourceSha256: binding.sourceSha256, commit: binding.commit, branch: 'without an abort', generatedSha256: hash(generated), extractedCaseSha256: hash(rawCase), control: 'await the actual builtin import result, then withhold that already-resolved result until 650ms after the real default outer timeout' };
  writeFileSync(join(directory, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', { flag: 'wx' });
  generations.push({ ...meta, input: directory });
}
}
writeFileSync(join(root, (process.argv[3] ?? 'candidate') + '-midbody-generation.json'), JSON.stringify(generations, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(generations, null, 2));
