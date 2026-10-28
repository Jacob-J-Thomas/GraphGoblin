import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { keys } from '../../api/queries.js';
import { useHarnessSwitch } from './model.js';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(keys.settings, {});
  client.setQueryData(keys.catalog, [
    {
      harness: 'claude',
      model: 'destination',
      enabled: true,
      ecosystemDefault: true,
      efforts: ['low', 'high'],
      defaultEffort: 'high',
    },
  ]);
  client.setQueryData(keys.preflight, [
    {
      harness: 'claude',
      state: 'ready',
      ok: true,
      authenticated: true,
      problems: [],
      models: [{ model: 'destination', efforts: ['low', 'high'] }],
    },
  ]);
  const { result } = renderHook(useHarnessSwitch, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, select: result.current };
}

it('reports a failed preflight lookup instead of using cached readiness or retrying it', async () => {
  const { client, select } = setup();
  const lookup = vi.fn().mockRejectedValue(new Error('preflight unavailable'));
  await expect(client.fetchQuery({ queryKey: keys.preflight, queryFn: lookup })).rejects.toThrow();
  const choice = await select('claude', 'old-model', 'none', {}, vi.fn());
  expect(choice).toEqual({
    message: expect.stringMatching(/Could not check Claude readiness.*Retry Claude preflight/),
  });
  expect(lookup).toHaveBeenCalledTimes(1);
});

it('reports invalid loop defaults separately from valid Settings defaults', async () => {
  const { select } = setup();
  const choice = await select(
    'claude',
    'old-model',
    'none',
    { byHarness: { claude: { effort: 'invalid' } } },
    vi.fn(),
  );
  expect(choice).toEqual({ message: expect.stringMatching(/configured defaults are invalid/) });
});

it('keeps an absent effort absent when changing an explicit model', async () => {
  const { select } = setup();
  expect(await select('claude', 'old-model', undefined, {}, vi.fn())).toEqual({
    model: 'destination',
    effort: undefined,
    message: undefined,
  });
});

it.each(['low', 'none'])(
  'keeps model inheritance and handles explicit effort %s without fetching',
  async (effort) => {
    const { client, select } = setup();
    const waiting = vi.fn();
    expect(await select('claude', undefined, effort, {}, waiting)).toEqual({
      effort: effort === 'low' ? 'low' : 'high',
      message: undefined,
    });
    expect(waiting).not.toHaveBeenCalled();
    expect(client.isFetching()).toBe(0);
  },
);

it('retains an effort-only selection when catalog support is unknown', async () => {
  const { client, select } = setup();
  client.removeQueries({ queryKey: keys.catalog });
  const selection = await select('claude', undefined, 'none', {}, vi.fn());
  expect(selection).not.toHaveProperty('effort');
  expect(selection.message).toMatch(/still loading/);
});

it('waits for an initial lookup that rejects, then reports failure without a second lookup', async () => {
  const { client, select } = setup();
  client.removeQueries({ queryKey: keys.preflight });
  let reject!: (reason: Error) => void;
  const lookup = client
    .fetchQuery({
      queryKey: keys.preflight,
      queryFn: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    })
    .catch(() => undefined);
  const waiting = vi.fn();
  const selection = select('claude', 'old-model', 'none', {}, waiting);
  expect(waiting).toHaveBeenCalledOnce();
  reject(new Error('no transport'));
  await lookup;
  expect(await selection).toEqual({
    message: expect.stringMatching(/Could not check Claude readiness/),
  });
});

it('chooses a loop model over distinct Settings and ecosystem models and takes loop effort first', async () => {
  const { client, select } = setup();
  client.setQueryData(
    keys.catalog,
    ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].map((model) => ({
      harness: 'codex',
      model,
      enabled: true,
      ecosystemDefault: model === 'gpt-6-luna',
      efforts: ['low', 'high'],
      defaultEffort: 'high',
    })),
  );
  client.setQueryData(keys.preflight, [
    { harness: 'codex', state: 'ready', ok: true, authenticated: true, problems: [] },
  ]);
  client.setQueryData(keys.settings, {
    defaults: { byHarness: { codex: { model: 'gpt-6.1-sol', effort: 'high' } } },
  });
  expect(
    await select(
      'codex',
      'claude-opus-5-5',
      'none',
      {
        byHarness: { codex: { model: 'gpt-6-astra', effort: 'low' } },
      },
      vi.fn(),
    ),
  ).toEqual({ model: 'gpt-6-astra', effort: 'low', message: undefined });
});

it('never queues a rewrite after a known catalog failure while another first check is pending', async () => {
  const { client, select } = setup();
  const catalog = client.getQueryData(keys.catalog);
  const preflight = client.getQueryData(keys.preflight);
  await expect(
    client.fetchQuery({
      queryKey: keys.catalog,
      queryFn: () => Promise.reject(new Error('catalog failed')),
    }),
  ).rejects.toThrow();
  client.removeQueries({ queryKey: keys.preflight });
  let resolve!: (value: unknown) => void;
  const pending = client.fetchQuery({
    queryKey: keys.preflight,
    queryFn: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const waiting = vi.fn();
  const selection = select('claude', 'authored', 'none', {}, waiting);
  client.setQueryData(keys.catalog, catalog);
  resolve(preflight);
  await pending;
  expect(await selection).toEqual({ message: expect.stringMatching(/Retry model catalog/) });
  expect(waiting).not.toHaveBeenCalled();
});

it('does not treat an in-flight retry of a failed initial catalog as its first lookup', async () => {
  const { client, select } = setup();
  const catalog = client.getQueryData(keys.catalog);
  client.removeQueries({ queryKey: keys.catalog });
  await expect(
    client.fetchQuery({
      queryKey: keys.catalog,
      queryFn: () => Promise.reject(new Error('catalog failed')),
    }),
  ).rejects.toThrow();
  let resolve!: (value: unknown) => void;
  const retry = client.fetchQuery({
    queryKey: keys.catalog,
    queryFn: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const waiting = vi.fn();
  const selection = select('claude', 'authored', 'none', {}, waiting);
  resolve(catalog);
  await retry;
  expect(await selection).not.toHaveProperty('model');
  expect(waiting).not.toHaveBeenCalled();
});

it('never rewrites after an initial lookup fails and recovers while another first check is pending', async () => {
  const { client, select } = setup();
  const catalog = client.getQueryData(keys.catalog);
  const preflight = client.getQueryData(keys.preflight);
  client.removeQueries({ queryKey: keys.catalog });
  client.removeQueries({ queryKey: keys.preflight });
  let reject!: (reason: Error) => void;
  let resolve!: (value: unknown) => void;
  const initialCatalog = client
    .fetchQuery({
      queryKey: keys.catalog,
      queryFn: () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    })
    .catch(() => undefined);
  const initialPreflight = client.fetchQuery({
    queryKey: keys.preflight,
    queryFn: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const selection = select('claude', 'authored', 'none', {}, vi.fn());
  reject(new Error('catalog unavailable'));
  await initialCatalog;
  client.setQueryData(keys.catalog, catalog);
  resolve(preflight);
  await initialPreflight;
  expect(await selection).not.toHaveProperty('model');
});

it('retains an effort-only authored value after a failed catalog lookup', async () => {
  const { client, select } = setup();
  await expect(
    client.fetchQuery({
      queryKey: keys.catalog,
      queryFn: () => Promise.reject(new Error('catalog failed')),
    }),
  ).rejects.toThrow();
  const selection = await select('claude', undefined, 'none', {}, vi.fn());
  expect(selection).not.toHaveProperty('model');
  expect(selection).not.toHaveProperty('effort');
  expect(selection.message).toMatch(/Retry model catalog/);
});

it('waits for first checks for an effort-only node without pinning its inherited model', async () => {
  const { client, select } = setup();
  client.removeQueries({ queryKey: keys.settings });
  let resolve!: (value: unknown) => void;
  const pending = client.fetchQuery({
    queryKey: keys.settings,
    queryFn: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const waiting = vi.fn();
  const selection = select('claude', undefined, 'none', {}, waiting);
  resolve({});
  await pending;
  expect(await selection).toEqual({ effort: 'high', message: undefined });
  expect(waiting).toHaveBeenCalledOnce();
});
