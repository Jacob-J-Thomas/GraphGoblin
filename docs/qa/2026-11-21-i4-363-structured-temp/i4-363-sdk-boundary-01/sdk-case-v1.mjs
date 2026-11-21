import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dump = (target, value) => fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
const errorData = (error) => ({ name: error?.name, message: error?.message, code: error?.code, retriable: error?.retriable, submission: error?.submission, syscall: error?.syscall, path: error?.path, stack: error?.stack, cause: error?.cause && String(error.cause) });
const state = { case: config.id, version: process.version, platform: process.platform, processCwd: process.cwd(), actualTemp: os.tmpdir(), tempLength: os.tmpdir().length, codexHome: process.env.CODEX_HOME, tempEntriesBefore: fs.readdirSync(config.temp), warnings: [], start: new Date().toISOString() };
dump(config.stateFile, state);
assert.equal(process.version, 'v22.23.4');
assert.equal(process.platform, 'win32');
assert.equal(os.tmpdir(), config.temp);
assert.equal(process.cwd(), config.cwd);
assert.equal(fs.existsSync(path.join(process.env.CODEX_HOME, 'config.toml')), true);
const { CodexStructured } = await import(pathToFileURL(path.join(config.checkout, 'packages/adapter-codex/src/structured.ts')).href);
const { CodexHarness } = await import(pathToFileURL(path.join(config.checkout, 'packages/adapter-codex/src/harness.ts')).href);
const cliEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(key)));
Object.assign(cliEnv, { NODE_OPTIONS: `--import=${pathToFileURL(config.fakeCli).href}`, GG_SDK_LISTING: config.listingFile, GG_SDK_TURN: config.turnFile });
const harness = new CodexHarness({
  codexBinary: process.execPath,
  env: cliEnv,
  preflightTimeoutMs: 10000,
  logger: { debug() {}, info() {}, error() {}, warn(details, message) { state.warnings.push({ details, message }); } },
});
try {
  const result = await new CodexStructured(harness).complete({ prompt: 'Harmless independent real-SDK structured boundary fixture; no provider call.', model: 'gpt-6-luna', effort: 'low', schema: config.schema }, new AbortController().signal);
  state.outcome = { kind: 'resolved', result };
} catch (error) {
  state.outcome = { kind: 'rejected', error: errorData(error) };
} finally {
  state.tempEntriesAfter = fs.readdirSync(config.temp);
  state.listingExists = fs.existsSync(config.listingFile);
  state.turnExists = fs.existsSync(config.turnFile);
  state.listing = state.listingExists ? JSON.parse(fs.readFileSync(config.listingFile, 'utf8')) : null;
  state.turn = state.turnExists ? JSON.parse(fs.readFileSync(config.turnFile, 'utf8')) : null;
  state.scratchExistsAfter = state.listing ? fs.existsSync(state.listing.cwd) : null;
  state.schemaDirExistsAfter = state.turn ? fs.existsSync(state.turn.schemaDir) : null;
  state.end = new Date().toISOString();
  dump(config.stateFile, state);
  console.log(JSON.stringify(state));
}
