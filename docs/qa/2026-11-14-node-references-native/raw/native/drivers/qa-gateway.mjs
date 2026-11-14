// #273 phase 2 QA gateway (Claude, not part of the change). Serves one checkout's BUILT web app
// from its BUILT API (apps/api/dist/testing/test-app.js: the real container and Fastify app with a
// provider-free fake harness) over a file SQLite store in this evidence directory. Nothing is
// written inside the checkout. Usage:
//   node qa-gateway.mjs <checkoutRoot> <label> <evidenceDir> <expectedWebListing|-> [<expectedHead>]
// Prints `QA_READY <url> <controlUrl>`; POST <controlUrl>/stop closes it and records the close.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, label, evidenceArg, listingArg, expectedHead] = process.argv.slice(2);
const root = await realpath(rootArg);
const evidence = await realpath(evidenceArg);
assert(relative(root, evidence).startsWith('..'), 'evidence must be outside the checkout');
// --no-optional-locks: reading identity never refreshes another checkout's index.
const git = (...args) =>
  execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8' }).trim();
const identity = () => ({
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  status: git('status', '--porcelain=v1'),
});
const start = identity();
if (expectedHead) assert.equal(start.head, expectedHead);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function files(dir, prefix = '.') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await files(join(dir, entry.name), path)));
    else out.push(path);
  }
  return out;
}
const dist = join(root, 'apps', 'web', 'dist');
// The same listing format as `find . -type f | LC_ALL=C sort | xargs sha256sum -b`.
const listed = (await files(dist)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const listing = (
  await Promise.all(listed.map(async (f) => `${digest(await readFile(join(dist, f)))} *${f}`))
).join('\n') + '\n';
const listingSha256 = digest(listing);
if (listingArg && listingArg !== '-') {
  const expected = await readFile(listingArg, 'utf8');
  assert.equal(listing.replace(/\r\n/g, '\n'), expected.replace(/\r\n/g, '\n'), 'web dist differs from the expected listing');
}
const apiEntry = join(root, 'apps', 'api', 'dist', 'testing', 'test-app.js');
const apiEntryHash = digest(await readFile(apiEntry));
const domainIndexHash = digest(await readFile(join(root, 'packages', 'domain', 'dist', 'index.js')));

for (const key of Object.keys(process.env))
  if (/^GG_|^(?:JEV_API_KEY|CODEX_HOME|CLAUDE_CONFIG_DIR|OLLAMA_HOST)$/i.test(key)) delete process.env[key];
await mkdir(join(evidence, 'stores'), { recursive: true });
const scratch = await mkdtemp(join(evidence, 'stores', `${label}-`));
const dbFile = join(scratch, 'graphgoblin.db').replace(/\\/g, '/');
const { createTestApp } = await import(pathToFileURL(apiEntry).href);
const test = await createTestApp({
  env: {
    GG_DATA_DIR: scratch,
    GG_DB_URL: `file:${dbFile}`,
    GG_WEB_DIST: dist,
    GG_GOBLIN_DIST: '',
    GG_LOG_LEVEL: 'error',
  },
});
const url = await test.app.listen({ host: '127.0.0.1', port: 0 });
const port = Number(new URL(url).port);
assert(![4747, 4748].includes(port));

// Served bytes equal the listed build.
const served = {};
for (const file of ['./index.html', ...listed.filter((f) => /^\.\/assets\/.*\.(?:js|css)$/.test(f))]) {
  const response = await fetch(`${url}/app/${file === './index.html' ? '' : file.slice(2)}`);
  assert.equal(response.ok, true, file);
  const actual = digest(Buffer.from(await response.arrayBuffer()));
  assert.equal(actual, digest(await readFile(join(dist, file))), file);
  served[file] = actual;
}

// Loopback control: script the fake harness, read what it was asked, stop.
let stopRequested = () => {};
const stopped = new Promise((done) => (stopRequested = done));
const control = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  try {
    let result;
    if (request.url === '/stop') {
      result = { stopping: true };
      setTimeout(stopRequested, 50);
    } else if (request.url === '/script') {
      const { turns } = JSON.parse(body || '{}');
      test.harness.script(
        turns.map(({ matchPrompt, finalText }) => ({
          ...(matchPrompt ? { match: (r) => r.prompt.includes(matchPrompt) } : {}),
          finalText,
        })),
      );
      result = { ok: true };
    } else if (request.url === '/requests') {
      result = { prompts: test.harness.started.map((r) => r.turn?.prompt ?? r.prompt ?? null) };
    } else {
      response.statusCode = 404;
      result = { error: 'unknown' };
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((done) => control.listen(0, '127.0.0.1', done));
const controlUrl = `http://127.0.0.1:${control.address().port}`;

const record = {
  label,
  root,
  ...start,
  node: process.version,
  pid: process.pid,
  url,
  controlUrl,
  scratch,
  dbFile,
  webDistFiles: listed.length,
  webListingSha256: listingSha256,
  expectedListing: listingArg ?? null,
  served,
  apiTestEntrySha256: apiEntryHash,
  domainDistIndexSha256: domainIndexHash,
  startedAt: new Date().toISOString(),
};
await writeFile(join(evidence, `gateway-${label}.json`), JSON.stringify(record, null, 2) + '\n');
await writeFile(join(evidence, `gateway-${label}-weblisting.txt`), listing);
console.log(`QA_READY ${url} ${controlUrl}`);

await stopped;
control.close();
await test.close();
const after = identity();
await writeFile(
  join(evidence, `gateway-${label}-closed.json`),
  JSON.stringify(
    {
      ...after,
      sameIdentity: JSON.stringify(after) === JSON.stringify(start),
      listening: test.app.server.listening,
      pid: process.pid,
      closedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
process.exit(0);
