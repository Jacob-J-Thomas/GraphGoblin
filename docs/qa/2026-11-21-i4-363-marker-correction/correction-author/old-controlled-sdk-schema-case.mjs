// A fresh Node host selects TEMP/TMP before importing the actual installed SDK. No fs/SDK mocks.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import { Codex } from 'file:///G:/ggq/gg-i4-363-structured/GraphGoblin/packages/adapter-codex/node_modules/@openai/codex-sdk/dist/index.js';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const recordFile = config.recordFile;
const controller = new globalThis.AbortController();
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => value !== undefined && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(key),
  ),
);
Object.assign(env, {
  NODE_OPTIONS: `--import=${new URL('./schema-cli.mjs', import.meta.url).href}`,
  GG_SCHEMA_RECORD: recordFile,
  GG_SCHEMA_MODE: config.mode,
});
const client = new Codex({ codexPathOverride: process.execPath, env });
const thread = client.startThread({
  workingDirectory: config.workingDirectory,
  sandboxMode: 'read-only',
  approvalPolicy: 'never',
  skipGitRepoCheck: true,
});
const entriesBefore = readdirSync(tmpdir());
let settled = false;
const work = thread
  .run('Harmless schema fixture; no provider call.', {
    outputSchema: config.schema,
    signal: controller.signal,
  })
  .then(
    (value) => ({ kind: 'resolved', finalResponse: value.finalResponse }),
    (error) => ({ kind: 'rejected', name: error.name, message: error.message }),
  )
  .finally(() => {
    settled = true;
  });
let schemaPresentAtAbort;
if (config.mode === 'abort') {
  const deadline = Date.now() + 3000;
  while (!existsSync(recordFile) && !settled && Date.now() < deadline) await delay(10);
  if (existsSync(recordFile)) {
    const record = JSON.parse(readFileSync(recordFile, 'utf8'));
    schemaPresentAtAbort = existsSync(record.schemaPath);
  }
  controller.abort();
}
const outcome = await work;
const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : undefined;
const state = {
  actualTemp: tmpdir(),
  entriesBefore,
  entriesAfter: readdirSync(tmpdir()),
  outcome,
  record,
  schemaPresentAtAbort,
  schemaDirectoryExistsAfter: record ? existsSync(record.schemaDirectory) : undefined,
};
writeFileSync(config.stateFile, JSON.stringify(state));
process.stdout.write(JSON.stringify(state) + '\n');
