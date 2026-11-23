import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packet = fileURLToPath(new URL('.', import.meta.url));
const binding = JSON.parse(readFileSync(join(packet, 'baseline-binding.json')));
const [candidatePath, expectedSha, tag, onlyMode] = process.argv.slice(2);
if (!/^[a-f0-9]{64}$/.test(expectedSha ?? '') || !/^[a-z0-9-]+$/.test(tag ?? '')) throw new Error('Expected source hash and safe tag required');
const input = readFileSync(candidatePath);
const hash = (data) => createHash('sha256').update(data).digest('hex');
if (hash(input) !== expectedSha) throw new Error('Candidate source drift');
const source = input.toString('utf8');
const sourceRoot = binding.sourceRoot.replaceAll('\\', '/');
const requireDependency = createRequire(binding.dependencyRoot + '/package.json');
const ts = requireDependency('typescript');
const file = ts.createSourceFile('probe-directory.test.ts', source, ts.ScriptTarget.Latest, true);
const suites = file.statements.filter(ts.isExpressionStatement).map((node) => node.expression).filter(ts.isCallExpression).filter((node) => node.expression.getText(file) === 'describe');
const suite = (title) => suites.find((node) => node.arguments[0]?.text === title);
const directSuite = suite('Codex readiness probe directory');
const lifecycleSuite = suite('Codex readiness probe case lifecycle (#466)');
if (!directSuite || !lifecycleSuite) throw new Error('Maintained suite boundary changed');
const statements = (node) => node.arguments[1].body.statements;
const directCase = statements(directSuite).find((node) => node.getText(file).includes("'runs the fake CLI under a 226-character TEMP/TMP/TMPDIR root and removes its probe'"));
const lifecycleCase = statements(lifecycleSuite).find((node) => node.getText(file).includes("'reports an ordinary case failure once, after the same settlement'"));
if (!directCase || !lifecycleCase) throw new Error('Maintained case missing');
const isTest = (node) => ts.isExpressionStatement(node) && /^it(?:\.|\()/.test(node.getText(file));
const definitions = statements(lifecycleSuite).filter((node) => !isTest(node)).map((node) => node.getFullText(file)).join('');
const relocate = (value) => value
  .replace("from './index.js'", `from '${sourceRoot}/packages/adapter-codex/src/index.ts'`)
  .replace("from './cli.js'", `from '${sourceRoot}/packages/adapter-codex/src/cli.ts'`)
  .replace("new URL('./fixtures/readiness-cli.mjs', import.meta.url)", `new URL('file:///${sourceRoot}/packages/adapter-codex/src/fixtures/readiness-cli.mjs')`);
const rawHelper = source.slice(0, directSuite.parent.getFullStart());
const instrument = (value) => {
  const rootLine = 'root = await probeFs.mkdtemp(join(tmpdir(), prefix));';
  const childLine = "if (started.type === 'return') probe.children.push(started.value);";
  if (!value.includes(rootLine) || !value.includes(childLine)) throw new Error('Observation boundary changed');
  return value.replace(rootLine, rootLine + " qaRoots.push(root); qaRecord('case-root-created', { root, signalAborted: context.signal.aborted });")
    .replace(childLine, "if (started.type === 'return') { probe.children.push(started.value); qaObserveChild(started.value, args); }");
};
const modes = ['pre-direct', 'pre-lifecycle', 'maintained-suite', 'helper-double-fault'];
const produced = [];
if (onlyMode && !modes.includes(onlyMode)) throw new Error('Unknown selected mode');
for (const mode of modes.filter((mode) => !onlyMode || mode === onlyMode)) {
  const directory = join(binding.scratchRoot, 'inputs', `${tag}-${mode}`);
  mkdirSync(directory, { recursive: true });
  if (mode.startsWith('pre-') || mode.startsWith('flight-') || mode.startsWith('timeout-')) {
    const rawCase = (mode.endsWith('direct') ? directCase : lifecycleCase).getFullText(file);
    writeFileSync(join(directory, 'extracted-maintained-case.ts.txt'), rawCase, { flag: 'wx' });
  }
  const observation = `
import { beforeEach, afterAll } from 'vitest';
import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { setTimeout as qaSleep } from 'node:timers/promises';
const qaMode = ${JSON.stringify(mode)};
const qaStart = performance.now();
const qaEvents = process.env.GG505_OUTPUT + '/events.jsonl';
const qaOriginalTemp = Object.fromEntries(TEMP_NAMES.map((name) => [name, process.env[name]]));
const qaRoots: string[] = [];
const qaChildren: ChildProcess[] = [];
let qaRunnerEntries: string[] = [];
let qaRequested = false;
function qaRecord(event: string, more = {}) { appendFileSync(qaEvents, JSON.stringify({ event, elapsedMs: Math.round(performance.now() - qaStart), ...more }) + '\\n'); }
function qaNativePresent(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}
function qaObserveChild(child: ChildProcess, args: string[]) {
  qaChildren.push(child);
  qaRecord('owned-child-created', { pid: child.pid, args });
  child.once('spawn', () => {
    qaRecord('owned-child-native-spawn', { pid: child.pid, args, nativePresent: qaNativePresent(child.pid) });
    if (qaMode.startsWith('flight-') && args.join(' ') === 'login status' && !qaRequested) {
      qaRequested = true; qaRecord('cancel-request-marker', { pid: child.pid, nativePresent: qaNativePresent(child.pid) });
      console.log('GG505_CANCEL_REQUEST owned-child-already-running');
    }
  });
  child.once('exit', (code, signal) => qaRecord('owned-child-native-exit', { pid: child.pid, code, signal, nativePresent: qaNativePresent(child.pid) }));
}
beforeEach(async (context) => {
  qaRunnerEntries = readdirSync(process.env.TEMP!);
  qaRecord('beforeEach-enter', { task: context.task.name, signalAborted: context.signal.aborted, runnerEntries: qaRunnerEntries, runnerTemp: process.env.TEMP });
  const aborted = Promise.withResolvers<void>();
  if (context.signal.aborted) aborted.resolve();
  context.signal.addEventListener('abort', () => { qaRecord('actual-enclosing-signal-abort', { reason: String(context.signal.reason) }); aborted.resolve(); }, { once: true });
  if (qaMode.startsWith('pre-')) {
    qaRecord('cancel-request-marker', { phase: 'beforeEach', signalAbortedBeforeRequest: context.signal.aborted });
    console.log('GG505_CANCEL_REQUEST beforeEach');
    const fallback = new AbortController();
    try { await Promise.race([aborted.promise, qaSleep(3000, undefined, { signal: fallback.signal }).then(() => { throw new Error('Genuine cancellation did not reach beforeEach'); })]); }
    finally { fallback.abort(); }
    qaRecord('beforeEach-leave-with-past-abort', { task: context.task.name, signalAborted: context.signal.aborted, reason: String(context.signal.reason) });
  }
  if (qaMode.startsWith('timeout-')) {
    const realFs = await vi.importActual<typeof probeFs>('node:fs/promises');
    vi.mocked(probeFs.readdir).mockImplementationOnce(async (path) => {
      qaRecord('held-real-readdir', { path: String(path) });
      const fallback = new AbortController();
      try { await Promise.race([aborted.promise.then(() => qaSleep(650)), qaSleep(9000, undefined, { signal: fallback.signal }).then(() => { throw new Error('Real default Vitest timeout not seen'); })]); }
      finally { fallback.abort(); }
      qaRecord('released-real-readdir');
      return realFs.readdir(path);
    });
  }
});
afterAll(() => {
  qaRecord('final-worker-observation', {
    rootsCreated: qaRoots, rootsStillPresent: qaRoots.filter((root) => existsSync(root)),
    envRestored: TEMP_NAMES.every((name) => process.env[name] === qaOriginalTemp[name]),
    runnerTemp: qaOriginalTemp.TEMP, runnerTempExists: existsSync(qaOriginalTemp.TEMP!),
    runnerEntriesAtHook: readdirSync(qaOriginalTemp.TEMP!), runnerEntriesAtBeforeEach: qaRunnerEntries,
    childrenCreated: qaChildren.length, livingOwnedChildren: qaChildren.filter(isRunning).map((child) => child.pid), nativeOwnedChildren: qaChildren.map((child) => child.pid).filter(qaNativePresent),
  });
});
`;
  let body;
  if (mode === 'maintained-suite') body = instrument(relocate(source)) + observation;
  else if (mode === 'ordinary-error') {
    body = instrument(relocate(rawHelper)) + observation + "\nit('ordinary direct body failure remains a failure once', probeCase('gg-qa-ordinary-', async (probe) => { useTempRoot(probe.root); const { harness } = fixture(probe); expect(await harness.preflight()).toMatchObject({ state: 'ready', ok: true }); throw new Error('QA505_ORDINARY_BODY_FAILURE'); }));\n";
  } else if (mode === 'helper-double-fault') {
    const previous = readFileSync('C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/i1-probe-466-independent-qa-correction-01/qa-cases.ts.txt');
    if (hash(previous) !== '646e5861c25efdc1783f9b0f00c4f313106f95f83acdc0a23116fb7a20c4c98f') throw new Error('Original helper error control drift');
    body = relocate(rawHelper) + "\nprocess.env.GG_466_QA_SCENARIO = 'double-fault'; process.env.GG_466_QA_OBSERVATION = process.env.GG505_OUTPUT + '/helper-events.jsonl';\n" + previous.toString('utf8');
  } else {
    let maintained = (mode.endsWith('direct') ? directCase : lifecycleCase).getFullText(file);
    if (mode.startsWith('flight-')) {
      if (!maintained.includes('fixture(probe);')) throw new Error('Maintained fixture boundary changed');
      maintained = maintained.replace('fixture(probe);', "fixture(probe, 'hang');");
    }
    body = instrument(relocate(rawHelper)) + observation + "\ndescribe('exact maintained entry under independent cancellation control', () => {\n" + (mode.endsWith('lifecycle') ? definitions : '') + maintained + '\n});\n';
  }
  const config = {
    root: directory.replaceAll('\\', '/'), cacheDir: join(binding.scratchRoot, 'cache', `${tag}-${mode}`).replaceAll('\\', '/'),
    server: { fs: { allow: [binding.scratchRoot, binding.sourceRoot, binding.dependencyRoot] } },
    resolve: { conditions: ['development'], alias: binding.aliases },
    test: { include: ['*.test.ts'], environment: 'node', clearMocks: true, restoreMocks: true, pool: 'forks', execArgv: ['--expose-gc'] },
  };
  writeFileSync(join(directory, 'case.test.ts'), body, { flag: 'wx' });
  writeFileSync(join(directory, 'vitest.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`, { flag: 'wx' });
  const meta = { mode, tag, candidatePath, sourceSha256: expectedSha, generatedSha256: hash(body), configSha256: hash(`export default ${JSON.stringify(config, null, 2)};\n`), originalDirectCaseSha256: hash(directCase.getFullText(file)), originalLifecycleCaseSha256: hash(lifecycleCase.getFullText(file)), lifecycleDefinitionsSha256: hash(definitions), observationChanges: ['relocated two imports and identical fixture URL', 'recorded root allocation and real spawn/exit without replacing native work', 'public beforeEach cancellation handshake or native-child-start cancellation marker', 'real first readdir held only in timeout controls', 'full original assertions and corrected ownership retained', ...(mode.startsWith('flight-') ? ['selected native hanging fake CLI scenario'] : [])] };
  writeFileSync(join(directory, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', { flag: 'wx' });
  produced.push({ mode, directory, ...meta });
}
writeFileSync(join(packet, `${tag}-generation.json`), JSON.stringify(produced, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(produced.map(({ mode, directory, sourceSha256, generatedSha256 }) => ({ mode, directory, sourceSha256, generatedSha256 })), null, 2));
