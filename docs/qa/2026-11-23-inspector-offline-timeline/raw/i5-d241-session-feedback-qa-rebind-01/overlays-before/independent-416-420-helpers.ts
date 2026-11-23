// PREPARED, NOT EXECUTED. Stage only in a root-admitted disposable candidate QA copy.
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';
import { readFileSync } from 'node:fs';
import { control } from './fixtures.js';

export type Control = (
  request: APIRequestContext,
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;
export type OwnedInstance = { instanceId: string; url: string };
const protectedPorts = new Set([4747, 4748, 7443, 11434]);

export function boundCandidate() {
  if (process.env['LIVE'] === '1') throw new Error('LIVE=1 is forbidden for independent UI QA');
  if (process.env['GG_E2E_MAIN_PORT'] !== '0' || process.env['GG_E2E_CONTROL_PORT'] !== '0')
    throw new Error('Explicit port0 server bindings required');
  const filename = process.env['I5_QA_CASE_BINDING'];
  if (!filename) throw new Error('Root final-source/build admission binding required');
  const value: unknown = JSON.parse(readFileSync(filename, 'utf8'));
  if (!value || typeof value !== 'object') throw new Error('Invalid admission binding');
  for (const key of [
    'candidateHead',
    'candidateTree',
    'buildManifestSha256',
    'lastObservedText',
  ] as const) {
    if (!(key in value) || typeof Reflect.get(value, key) !== 'string')
      throw new Error('Missing binding ' + key);
  }
  const binding = value as {
    candidateHead: string;
    candidateTree: string;
    buildManifestSha256: string;
    lastObservedText: string;
  };
  if (
    !/^[a-f0-9]{40}$/.test(binding.candidateHead) ||
    !/^[a-f0-9]{40}$/.test(binding.candidateTree) ||
    !/^[a-f0-9]{64}$/.test(binding.buildManifestSha256) ||
    binding.lastObservedText !== 'Last observed, may be out of date'
  )
    throw new Error('Source/build/UI binding invalid');
  requireOwnedLoopback(process.env['GG_E2E_BASE_URL'] ?? '');
  requireOwnedLoopback(process.env['GG_E2E_CONTROL_URL'] ?? '');
  return binding;
}

/** No live-provider, threadHistory, classifier or arbitrary env override control is allowed. */
export const ownedControl: Control = async (request, path, body = {}) => {
  requireOwnedLoopback(process.env['GG_E2E_CONTROL_URL'] ?? '');
  if (
    !['/apps', '/api/listener', '/harness/script', '/harness/requests', '/clock/advance'].includes(
      path,
    )
  )
    throw new Error('Unadmitted control path');
  if (path === '/apps') {
    if (!body || typeof body !== 'object') throw new Error('Expected ordinary app options');
    for (const key of Object.keys(body))
      if (key !== 'requireApiKey') throw new Error('Unadmitted app option ' + key);
  }
  return control(request, path, body);
};

export async function createOwnedInstance(request: APIRequestContext): Promise<OwnedInstance> {
  const created = await ownedControl(request, '/apps', { requireApiKey: false });
  if (typeof created['instanceId'] !== 'string' || typeof created['url'] !== 'string')
    throw new Error('Owned instance identity missing');
  requireOwnedLoopback(created['url']);
  return { instanceId: created['instanceId'], url: created['url'] };
}

export function requireOwnedLoopback(url: string): URL {
  const parsed = new URL(url);
  const port = Number(parsed.port);
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !Number.isInteger(port) ||
    port < 1 ||
    protectedPorts.has(port)
  ) {
    throw new Error('Exact disposable loopback origin required; owner ports are forbidden');
  }
  return parsed;
}

export async function setOwnedListener(
  control: Control,
  request: APIRequestContext,
  instance: OwnedInstance,
  listening: boolean,
) {
  requireOwnedLoopback(instance.url);
  if (!instance.instanceId.startsWith('e2e-instance-'))
    throw new Error('Dedicated extra disposable API instance required');
  await control(request, '/api/listener', { instanceId: instance.instanceId, listening });
}

export function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export function recordOwnedRequests(page: Page, origin: string) {
  const owned = requireOwnedLoopback(origin).origin;
  const rows: {
    ordinal: number;
    method: string;
    path: string;
    status?: number;
    failed?: boolean;
    finished?: boolean;
    stream: boolean;
  }[] = [];
  let changedAt = Date.now();
  const index = new Map<Request, number>();
  const sent = (request: Request) => {
    const url = new URL(request.url());
    if (url.origin !== owned) return;
    index.set(request, rows.length);
    const stream = (request.headers()['accept'] ?? '').includes('text/event-stream');
    rows.push({
      ordinal: rows.length + 1,
      method: request.method(),
      path: url.pathname + url.search,
      stream,
    });
    if (!stream) changedAt = Date.now();
  };
  const returned = (response: Awaited<ReturnType<Request['response']>>) => {
    if (!response) return;
    const at = index.get(response.request());
    if (at !== undefined) rows[at]!.status = response.status();
  };
  const failed = (request: Request) => {
    const at = index.get(request);
    if (at !== undefined) {
      rows[at]!.failed = true;
      if (!rows[at]!.stream) changedAt = Date.now();
    }
  };
  const finished = (request: Request) => {
    const at = index.get(request);
    if (at !== undefined) {
      rows[at]!.finished = true;
      if (!rows[at]!.stream) changedAt = Date.now();
    }
  };
  page.on('request', sent);
  page.on('response', returned);
  page.on('requestfailed', failed);
  page.on('requestfinished', finished);
  return {
    rows,
    writes: () => rows.filter((row) => !['GET', 'HEAD', 'OPTIONS'].includes(row.method)),
    quietFor: () => Date.now() - changedAt,
    pendingReads: () =>
      rows.filter((row) => row.method === 'GET' && !row.stream && !row.failed && !row.finished)
        .length,
    stop: () => {
      page.off('request', sent);
      page.off('response', returned);
      page.off('requestfailed', failed);
      page.off('requestfinished', finished);
    },
  };
}

/** Initial SSE batch/live invalidations must finish before any recovery read budget begins. */
export async function initialInspectorSettled(
  page: Page,
  log: ReturnType<typeof recordOwnedRequests>,
  path: string,
) {
  await expect(page.getByRole('list', { name: 'Timeline', exact: true })).toContainText(
    'run.started',
  );
  await expect
    .poll(
      () =>
        log.rows.filter(
          (row) => row.method === 'GET' && row.path === path && row.status === 200 && row.finished,
        ).length,
    )
    .toBeGreaterThan(0);
  await expect.poll(() => log.pendingReads() === 0 && log.quietFor() >= 2200).toBe(true);
}

/** Delay actual browser dispatch; release/drain before unroute. No fabricated response/cache write. */
export async function holdOwnedRequests(
  page: Page,
  origin: string,
  method: string,
  exactPath: string,
) {
  const owned = requireOwnedLoopback(origin).origin;
  if (!exactPath.startsWith('/runs/')) throw new Error('Bound run endpoint required');
  const gate = deferred();
  let captured = 0;
  let active = 0;
  const match = (url: URL) => url.origin === owned && url.pathname === exactPath;
  const handler = async (route: Route) => {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }
    captured++;
    active++;
    try {
      await gate.promise;
      await route.continue();
    } finally {
      active--;
    }
  };
  await page.route(match, handler);
  return {
    captured: () => captured,
    active: () => active,
    release: gate.release,
    close: async () => {
      gate.release();
      await expect.poll(() => active).toBe(0);
      await page.unroute(match, handler);
    },
  };
}

/** A controlled browser response hold around a real server read/preview, explicitly labelled. */
export async function holdOwnedResponse(
  page: Page,
  origin: string,
  method: string,
  exactPath: string,
) {
  const owned = requireOwnedLoopback(origin).origin;
  if (!exactPath.startsWith('/runs/')) throw new Error('Bound run endpoint required');
  const gate = deferred();
  let arrived = 0;
  let active = 0;
  const match = (url: URL) => url.origin === owned && url.pathname === exactPath;
  const handler = async (route: Route) => {
    if (route.request().method() !== method) {
      await route.continue();
      return;
    }
    active++;
    try {
      const realResponse = await route.fetch();
      arrived++;
      await gate.promise;
      await route.fulfill({ response: realResponse });
    } finally {
      active--;
    }
  };
  await page.route(match, handler);
  return {
    arrived: () => arrived,
    active: () => active,
    release: gate.release,
    close: async () => {
      gate.release();
      await expect.poll(() => active).toBe(0);
      await page.unroute(match, handler);
    },
  };
}

/** Contract permits closing the review or retaining it with confirmation unavailable. */
export async function expectExpiredReview(dialog: Locator, confirm: Locator) {
  if (await dialog.isVisible()) await expect(confirm).toBeDisabled();
  else await expect(dialog).toBeHidden();
}

/** Call only after meaningful UI/HTTP completion; this is a fixed budget observation, not readiness. */
export async function expectNoFurtherWritesForQuietSample(
  page: Page,
  writes: () => unknown[],
  before: number,
) {
  expect(writes()).toHaveLength(before);
  await page.waitForTimeout(2200);
  expect(writes()).toHaveLength(before);
}
