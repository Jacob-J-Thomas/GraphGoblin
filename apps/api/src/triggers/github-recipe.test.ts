import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TriggerConfigSchema, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { FakeClock, FakeHarness, CapturingLogger } from '@graphgoblin/engine/testing';
import { ProcessScripts } from '@graphgoblin/infrastructure/process';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createContainer, type Container } from '../container.js';

// The documented wrapper runs unchanged, with its child-process call redirected to a controlled
// local CLI emitting curated NDJSON page by page. This verifies wrapper behavior and argument
// forwarding; it does not validate installed gh/jq or contact GitHub.
const fakeGh = `import { readFileSync } from 'node:fs';
const [pagesFile, ...args] = process.argv.slice(2);
if (args[0] !== 'api' || args[1] !== '--method' || args[2] !== 'GET' ||
    args[3] !== '--paginate' ||
    args[4] !== 'repos/OWNER/REPO/issues?state=open&labels=ready&per_page=100' ||
    args[5] !== '--jq' || args[6] !== '.[] | select(.pull_request == null) | {number,title,updated_at,url:.html_url} | @json') {
  process.stderr.write('fake gh unexpected arguments'); process.exit(2);
}
const pages = JSON.parse(readFileSync(pagesFile, 'utf8'));
for (const page of pages) {
  const result = page.filter((item) => item.state === 'open' && item.labels.includes('ready'))
    .filter((item) => item.pull_request == null)
    .map(({number, title, updated_at, html_url}) => ({number, title, updated_at, url: html_url}));
  for (const item of result) process.stdout.write(JSON.stringify(item)+'\\n');
}
process.stderr.write('credential-marker: internal process diagnostics');
`;
const root = fileURLToPath(new URL('../../../../', import.meta.url));
async function recipe() {
  const guide = await readFile(join(root, 'docs/guide/04-triggers.md'), 'utf8');
  const configs = [...guide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
    .map((match) => TriggerConfigSchema.safeParse(JSON.parse(match[1]!)))
    .filter((result) => result.success)
    .map((result) => result.data);
  const selected = configs.find(
    (config) =>
      config?.subtype === 'poll' &&
      config.items &&
      config.probe.kind === 'script' &&
      config.probe.command === 'node',
  );
  if (!selected || selected.subtype !== 'poll' || selected.probe.kind !== 'script')
    throw new Error('documented gh items recipe missing');
  return selected;
}
function definition(
  config: Extract<ReturnType<typeof TriggerConfigSchema.parse>, { subtype: 'poll' }>,
): LoopDefinitionInput {
  return {
    schemaVersion: 3,
    name: 'offline-gh-recipe',
    nodes: [
      { id: 'issues', kind: 'trigger', label: 'GitHub issues', config },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { return: { mapping: 'trigger.payload' } },
      },
    ],
    edges: [{ id: 'out', from: { node: 'issues', port: 'out' }, to: { node: 'done' } }],
  };
}
function issue(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    updated_at: '2026-10-02T12:00:00Z',
    html_url: `https://example.test/issues/${number}`,
    state: 'open',
    labels: ['ready'],
    body: 'sensitive-body-marker',
    user: { token: 'credential-marker' },
    ...extra,
  };
}
async function fixture() {
  const dataDir = join(root, '.tmp', `github-recipe-${crypto.randomUUID()}`);
  await mkdir(dataDir, { recursive: true });
  // Retain disposable SQLite fixtures: Windows libsql native handles may outlive close briefly.
  const command = join(dataDir, 'fake-gh.mjs'),
    pagesFile = join(dataDir, 'pages.json'),
    preload = join(dataDir, 'controlled-gh.cjs');
  await writeFile(command, fakeGh);
  const selected = await recipe();
  if (selected.probe.kind !== 'script') throw new Error('script recipe required');
  const preloadCode = `const assert=require('node:assert/strict');const cp=require('node:child_process');const original=cp.spawnSync;cp.spawnSync=(command,args,options)=>{assert.equal(command,'gh');assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.maxBuffer,65536);assert.equal(options.timeout,55000);return original(process.execPath,[${JSON.stringify(command)},${JSON.stringify(pagesFile)},...args],options)};`;
  await writeFile(preload, preloadCode);
  const config = {
    ...selected,
    probe: {
      ...selected.probe,
      command: process.execPath,
      args: ['--require', preload, ...selected.probe.args],
    },
  };
  const clock = new FakeClock(),
    logger = new CapturingLogger();
  const boot = async (): Promise<Container> => {
    const container = await createContainer(
      loadConfig({
        GG_DATA_DIR: dataDir,
        GG_DB_URL: `file:${join(dataDir, 'gg.db').replaceAll('\\', '/')}`,
        GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
      }),
      {
        clock,
        logger,
        scripts: new ProcessScripts({ baseEnv: {} }),
        harnesses: { codex: new FakeHarness() },
        startTimers: false,
      },
    );
    await container.start();
    container.polls.stop();
    return container;
  };
  const first = await boot(),
    app = await buildApp(first, { logger: false });
  const response = await app.inject({
    method: 'POST',
    url: '/loops',
    payload: { definition: definition(config) },
  });
  expect(response.statusCode).toBe(201);
  const id = response.json<{ loop: { id: string } }>().loop.id;
  expect((await app.inject({ method: 'POST', url: `/loops/${id}/publish` })).statusCode).toBe(200);
  await app.close();
  return {
    first,
    boot,
    id,
    clock,
    logger,
    pages: (pages: unknown[][]) => writeFile(pagesFile, JSON.stringify(pages)),
  };
}
describe('documented GitHub polling recipe with a controlled local CLI', () => {
  it('curates all pages, drains five then the tail, and retains seen keys through a stopped restart', async () => {
    const fixtureData = await fixture();
    const { first, clock, id } = fixtureData;
    let current = first;
    try {
      await fixtureData.pages([
        [
          issue(1),
          issue(2),
          issue(101, { pull_request: { url: 'fake' } }),
          issue(102, { state: 'closed' }),
        ],
        Array.from({ length: 6 }, (_, index) => issue(index + 3)),
      ]);
      clock.advance(60_000);
      const batch = await first.polls.poll();
      expect(batch).toHaveLength(5);
      await first.manager.waitForIdle();
      expect(
        (await first.repos.runs.getInitialThread(batch[0]!.id))?.invocation.trigger.payload,
      ).toEqual({
        number: 1,
        title: 'Issue 1',
        updated_at: '2026-10-02T12:00:00Z',
        url: 'https://example.test/issues/1',
      });
      expect(JSON.stringify(await first.repos.runs.getInitialThread(batch[0]!.id))).not.toContain(
        'marker',
      );
      await first.stop();
      current = await fixtureData.boot();
      clock.advance(60_000);
      expect(await current.polls.poll()).toHaveLength(3);
      await current.manager.waitForIdle();
      clock.advance(60_000);
      expect(await current.polls.poll()).toEqual([]);
      expect(await current.repos.runs.list({ loopId: id })).toHaveLength(8);
    } finally {
      await current.stop();
    }
  });
  it('refuses a pagination result above 200 before lookup or admission and keeps process diagnostics private', async () => {
    const { first, clock, id, logger, pages } = await fixture();
    try {
      await pages([
        Array.from({ length: 100 }, (_, index) => issue(index + 1)),
        Array.from({ length: 101 }, (_, index) => issue(index + 101)),
      ]);
      const lookup = vi.spyOn(first.repos.runs, 'findTriggerDedupeKeys');
      clock.advance(60_000);
      expect(await first.polls.poll()).toEqual([]);
      expect(lookup).not.toHaveBeenCalled();
      expect(await first.repos.runs.list({ loopId: id })).toEqual([]);
      expect(logger.lines).toContainEqual(
        expect.objectContaining({ obj: expect.objectContaining({ code: 'POLL_PROBE_FAILED' }) }),
      );
      expect(JSON.stringify(logger.lines)).not.toContain('credential-marker');
    } finally {
      await first.stop();
    }
  });
  it.each(['child-buffer', 'final-array'] as const)(
    'refuses the %s byte boundary before lookup or admission',
    async (boundary) => {
      const { first, clock, id, logger, pages } = await fixture();
      try {
        const curated = {
          number: 1,
          title: '',
          updated_at: '2026-10-02T12:00:00Z',
          url: 'https://example.test/issues/1',
        };
        const baseBytes = Buffer.byteLength(JSON.stringify(curated) + '\n', 'utf8');
        // NDJSON at exactly65536bytes produces an array one byte larger. The wrapper checks both
        // limits; otherwise ProcessScripts would silently have to truncate a valid JSON document.
        const titleBytes = boundary === 'child-buffer' ? 65537 : 65536 - baseBytes;
        await pages([[issue(1, { title: 'x'.repeat(titleBytes) })]]);
        const lookup = vi.spyOn(first.repos.runs, 'findTriggerDedupeKeys');
        clock.advance(60_000);
        expect(await first.polls.poll()).toEqual([]);
        expect(lookup).not.toHaveBeenCalled();
        expect(await first.repos.runs.list({ loopId: id })).toEqual([]);
        expect(logger.lines).toContainEqual(
          expect.objectContaining({ obj: expect.objectContaining({ code: 'POLL_PROBE_FAILED' }) }),
        );
        expect(JSON.stringify(logger.lines)).not.toContain('credential-marker');
      } finally {
        await first.stop();
      }
    },
  );
  it('observes only current state and cannot reconstruct a label transition between snapshots', async () => {
    const { first, clock, id, pages } = await fixture();
    try {
      await pages([[issue(1, { labels: ['other'] })]]);
      clock.advance(60_000);
      expect(await first.polls.poll()).toEqual([]);
      // A ready label was added and removed between polls; neither observed snapshot carries it.
      await pages([[issue(1, { labels: ['other'] })]]);
      clock.advance(60_000);
      expect(await first.polls.poll()).toEqual([]);
      expect(await first.repos.runs.list({ loopId: id })).toEqual([]);
      await pages([[issue(1)]]);
      clock.advance(60_000);
      expect(await first.polls.poll()).toHaveLength(1);
      await first.manager.waitForIdle();
      expect(await first.repos.runs.list({ loopId: id })).toHaveLength(1);
    } finally {
      await first.stop();
    }
  });
});
