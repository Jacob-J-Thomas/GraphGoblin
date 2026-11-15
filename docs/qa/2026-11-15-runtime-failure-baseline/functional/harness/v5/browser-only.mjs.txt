// Browser-only environment probe. Root admission is separate from functional admission.
import assert from 'node:assert/strict';
import { lstat, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { abs, batch, contained, hash, json, root, save } from './binding.mjs';
import { browserProcesses, launchOwnedEdge, stamp, within } from './native.mjs';

assert.equal(process.version, 'v22.23.4');
assert.equal(process.env.NODE_OPTIONS, undefined);
const [input, inputHash] = process.argv.slice(2);
assert.match(inputHash ?? '', /^[a-f0-9]{64}$/u);
const inputPath = await realpath(abs(input));
assert(contained(batch, inputPath));
assert.equal(await hash(inputPath), inputHash);
const config = await json(inputPath);
assert.equal(config.schema, 'gg381-browser-only-admission/v1');
assert.equal(config.state, 'root-admitted');
assert.match(config.attempt, /^browser-only-attempt-[1-9][0-9]*$/u);
const files = ['binding.mjs', 'native.mjs', 'browser-only.mjs'];
const hashes = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await hash(join(root, file))])));
assert.deepEqual(hashes, config.harness);
const bindingPath = await realpath(abs(config.binding));
assert(contained(batch, bindingPath));
assert.equal(await hash(bindingPath), config.bindingSha256);
const binding = await json(bindingPath);
assert.equal(binding.schema, 'gg381-build-binding/v1');
assert.equal(binding.head, config.head);
assert.equal(await realpath(process.execPath), binding.nodePath);
assert(contained(binding.checkout, binding.dependencies.playwright.path));
for (const [path, expected] of [
  [binding.nodePath, binding.nodeSha256],
  [binding.browserPath, binding.browserSha256],
  [binding.dependencies.playwright.path, binding.dependencies.playwright.sha256],
]) {
  assert.equal(await realpath(abs(path)), path);
  assert.equal(await hash(path), expected);
}

const out = join(root, config.attempt);
await mkdir(out);
assert.equal(await realpath(out), out);
const data = join(out, 'disposable');
await mkdir(data);
assert.equal(await realpath(data), data);
const profile = join(data, 'edge-profile');
const state = {};
const receipt = {
  scope: 'one isolated about:blank startup, with no GraphGoblin application or provider',
  pid: process.pid, startedAt: stamp(), inputPath, inputHash, bindingPath, hashes, profile,
  browserPath: binding.browserPath, browserSha256: binding.browserSha256,
  started: false, observed: null, cleanup: { errors: [] },
};

async function verifyDisposableEntries() {
  const directories = [data];
  while (directories.length) {
    const dir = directories.pop();
    assert.equal(await realpath(dir), dir);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      assert(contained(data, path) && (entry.isDirectory() || entry.isFile()));
      assert.equal(await realpath(path), path, 'Unexpected resolved browser scratch entry');
      if (entry.isDirectory()) directories.push(path);
    }
  }
}

await save(join(out, 'launch.json'), receipt);
try {
  const context = await launchOwnedEdge(binding, profile, 30000, state);
  receipt.started = true;
  state.owned = await browserProcesses(binding, profile, 10000);
  assert(state.owned.length > 0, 'No exact browser profile process identified');
  await context.route('**/*', (route) => route.abort());
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('about:blank', { timeout: 10000, waitUntil: 'load' });
  receipt.observed = await within(page.evaluate(() => ({
    href: location.href, title: document.title, readyState: document.readyState,
  })), 10000, 'about:blank document response');
  assert.deepEqual(receipt.observed, { href: 'about:blank', title: '', readyState: 'complete' });
} catch (error) {
  receipt.firstFailure = { name: error.name, message: error.message, stack: error.stack, at: stamp() };
  await save(join(out, 'first-failure.json'), receipt.firstFailure);
} finally {
  receipt.browserEnvironmentKeys = state.environmentKeys ?? [];
  receipt.browserTemp = state.temp ?? null;
  const reportCleanup = (step, error) => receipt.cleanup.errors.push({ step, message: error.message, at: stamp() });
  try {
    if (state.attempted) receipt.cleanup.before = state.owned ?? await browserProcesses(binding, profile, 10000);
  } catch (error) { reportCleanup('pre-close process readback', error); }
  try {
    if (state.context) await within(state.context.close(), 15000, 'close exact Edge context');
  } catch (error) { reportCleanup('close owned browser context', error); }
  try {
    if (state.attempted) {
      const deadline = Date.now() + 10000;
      do {
        const remaining = deadline - Date.now();
        assert(remaining > 0, 'Browser close readback budget exhausted');
        receipt.cleanup.after = await browserProcesses(binding, profile, remaining, receipt.cleanup.before ?? []);
        if (receipt.cleanup.after.length === 0) break;
        await delay(Math.min(100, Math.max(0, deadline - Date.now())));
      } while (Date.now() < deadline);
      assert.deepEqual(receipt.cleanup.after, []);
    }
  } catch (error) { reportCleanup('post-close process readback', error); }
  try {
    assert(contained(out, data) && await realpath(data) === data);
    if (receipt.cleanup.errors.length === 0) {
      await verifyDisposableEntries();
      await rm(data, { recursive: true, maxRetries: 0 });
      await assert.rejects(lstat(data), { code: 'ENOENT' });
      receipt.cleanup.removed = true;
    }
  } catch (error) { reportCleanup('disposable profile and temp removal', error); }
  receipt.finishedAt = stamp();
  await save(join(out, 'result.json'), receipt);
}
if (receipt.firstFailure || receipt.cleanup.errors.length) {
  process.stderr.write((receipt.firstFailure?.message ?? receipt.cleanup.errors[0].message) + '\n');
  process.exitCode = 1;
}
