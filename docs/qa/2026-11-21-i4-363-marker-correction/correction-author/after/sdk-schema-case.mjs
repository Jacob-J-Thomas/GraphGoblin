// A fresh Node host selects TEMP/TMP before importing the actual installed SDK. No fs/SDK mocks.
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import { Codex } from '@openai/codex-sdk';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const recordFile = config.recordFile;
const pauseFile = `${recordFile}.paused`;
const releaseFile = `${recordFile}.release`;
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
if (config.publicationBarrier) {
  Object.assign(env, { GG_SCHEMA_PAUSE_FILE: pauseFile, GG_SCHEMA_RELEASE_FILE: releaseFile });
}
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
let record;
let publicationWindow;
let observationError;
let outcome;
try {
  if (config.mode === 'abort') {
    const deadline = Date.now() + 3000;
    while (!existsSync(recordFile) && !settled && Date.now() < deadline) {
      if (config.publicationBarrier && !publicationWindow && existsSync(pauseFile)) {
        const { pendingFile } = JSON.parse(readFileSync(pauseFile, 'utf8'));
        publicationWindow = {
          finalMarkerExists: existsSync(recordFile),
          observerWaiting: true,
          workSettled: settled,
          pendingFile,
          pendingRecord: JSON.parse(readFileSync(pendingFile, 'utf8')),
        };
        writeFileSync(releaseFile, 'Release publication', { flag: 'wx' });
      }
      await delay(10);
    }
    if (existsSync(recordFile)) {
      // Preserve the child's identity for the fault controls, then fail the actual observation.
      if (config.observerFault) {
        record = JSON.parse(readFileSync(recordFile, 'utf8'));
        if (config.observerFault === 'read') unlinkSync(recordFile);
        else if (config.observerFault === 'parse') writeFileSync(recordFile, '{');
        else throw new Error(`Unknown observer fault: ${config.observerFault}`);
      }
      record = JSON.parse(readFileSync(recordFile, 'utf8'));
      schemaPresentAtAbort = existsSync(record.schemaPath);
    }
  } else {
    outcome = await work;
    record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, 'utf8')) : undefined;
  }
} catch (error) {
  observationError = error;
} finally {
  // An observation failure must not strand the SDK work or replace the original fault.
  if (config.mode === 'abort' || observationError) controller.abort();
  outcome = await work;
}
function childIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
let childAliveAfter;
if (record) {
  const deadline = Date.now() + 3000;
  while (childIsAlive(record.pid) && Date.now() < deadline) await delay(10);
  childAliveAfter = childIsAlive(record.pid);
}
const state = {
  actualTemp: tmpdir(),
  entriesBefore,
  entriesAfter: readdirSync(tmpdir()),
  outcome,
  record,
  schemaPresentAtAbort,
  workSettled: settled,
  childAliveAfter,
  publicationWindow: publicationWindow
    ? { ...publicationWindow, pendingFileExistsAfter: existsSync(publicationWindow.pendingFile) }
    : undefined,
  observationError: observationError
    ? {
        name: observationError.name,
        message: observationError.message,
        code: observationError.code,
      }
    : undefined,
  schemaDirectoryExistsAfter: record ? existsSync(record.schemaDirectory) : undefined,
};
writeFileSync(config.stateFile, JSON.stringify(state));
process.stdout.write(JSON.stringify(state) + '\n');
if (observationError) throw observationError;
