import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const { CodexHarness } = await import(pathToFileURL(resolve(process.cwd(), 'packages/adapter-codex/dist/index.js')).href);

const inherited = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.toUpperCase().startsWith("GG_") && !['NODE_OPTIONS', 'NODE_V8_COVERAGE', 'JEV_API_KEY', 'GG_JEV_API_KEY'].includes(key)));
const results = [];
for (const mode of ['wrapper', 'parse', 'completed', 'auth', 'invalid-value', 'missing-thread-text']) {
  const harness = new CodexHarness({
    codexBinary: process.execPath,
    env: { ...inherited, NODE_OPTIONS: `--import=${new URL('./fake-codex.mjs', import.meta.url).href}`, GG_RV_426_CASE: mode },
  });
  const session = harness.start({ workingDirectory: process.cwd(), model: 'gpt-6-luna', effort: 'low', options: { sandbox: 'read-only', approval: 'never' }, turn: { prompt: 'Synthetic audit; no provider call' } }, new AbortController().signal);
  const events = [];
  for await (const event of session.events) events.push(event);
  let failure;
  try { await session.result; } catch (error) { failure = { code: error.code, message: error.message }; }
  results.push({ mode, events, failure });
}
const output = JSON.stringify(results, null, 2) + '\n';
writeFileSync(new URL('../error-probes.log.txt', import.meta.url), output, 'utf8');
console.log(output);
