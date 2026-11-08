import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OllamaConnectionView } from '@graphgoblin/contracts';
import { FakeHarness } from '@graphgoblin/engine/testing';
import type { OllamaServices } from '@graphgoblin/infrastructure/ollama';
import { SqliteOllamaRepository } from '@graphgoblin/infrastructure/sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer, type Container } from './container.js';

let dataDir: string;
let container: Container | undefined;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gg-ollama-container-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await container?.stop();
  container = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

function config(env: Record<string, string> = {}) {
  return loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: ':memory:',
    GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    GG_OLLAMA_ENABLED: 'false',
    GG_OLLAMA_URL: 'http://models.example:11434/',
    ...env,
  });
}

function services() {
  const view: OllamaConnectionView = {
    connection: { enabled: false, baseUrl: 'http://models.example:11434', revision: 1 },
    discovery: { state: 'idle' },
  };
  const result = {
    harness: new FakeHarness([], 'ollama'),
    view: vi.fn(() => Promise.resolve(view)),
    configure: vi.fn(() => Promise.resolve(view)),
    refresh: vi.fn(() => Promise.resolve(view.discovery)),
    start: vi.fn(),
    stop: vi.fn(() => Promise.resolve()),
  } satisfies OllamaServices;
  return result;
}

describe('Ollama composition lifecycle', () => {
  it('wires the native harness and supplies the canonical process connection fallback', async () => {
    container = await createContainer(config(), { startTimers: false });
    await container.start();
    expect(container.ports.harnesses.ollama).toBe(container.ollama.harness);
    expect(container.ollama.harness.id).toBe('ollama');
    expect(await container.ollama.view()).toMatchObject({
      connection: { enabled: false, baseUrl: 'http://models.example:11434', revision: 1 },
      discovery: { state: 'idle' },
    });
  });

  it('retains the saved connection and disabled state over new process fallbacks after restart', async () => {
    const dbUrl = `file:${join(dataDir, 'gateway.db')}`;
    container = await createContainer(config({ GG_DB_URL: dbUrl }), { startTimers: false });
    await container.start();
    await container.ollama.configure({ enabled: false, baseUrl: 'https://saved.models.example' });
    await container.stop();
    container = await createContainer(
      config({
        GG_DB_URL: dbUrl,
        GG_OLLAMA_URL: 'http://new.models.example:11434',
        GG_OLLAMA_ENABLED: 'true',
      }),
      { startTimers: false },
    );
    await container.start();
    expect(await container.ollama.view()).toMatchObject({
      connection: { enabled: false, baseUrl: 'https://saved.models.example', revision: 2 },
      discovery: { state: 'idle' },
    });
  });

  it('starts discovery once after durable Chat setup without replacing an explicit harness fixture', async () => {
    const ollama = services();
    const harness = new FakeHarness();
    const order: string[] = [];
    ollama.start.mockImplementation(() => {
      order.push('discovery');
    });
    container = await createContainer(config(), {
      startTimers: false,
      ollama,
      harnesses: { codex: harness },
    });
    const ensureGateway = container.repos.chat.ensureGateway.bind(container.repos.chat);
    vi.spyOn(container.repos.chat, 'ensureGateway').mockImplementation(async (...args) => {
      const gateway = await ensureGateway(...args);
      order.push('chat-ready');
      return gateway;
    });
    await Promise.all([container.start(), container.start()]);
    expect(order).toEqual(['chat-ready', 'discovery']);
    expect(ollama.start).toHaveBeenCalledOnce();
    expect(container.ollama).toBe(ollama);
    expect(container.ports.harnesses).toEqual({ codex: harness });
  });

  it('stops discovery immediately during shutdown and retains SQLite until it has stopped', async () => {
    const ollama = services();
    let release!: () => void;
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    ollama.stop.mockReturnValue(stopped);
    container = await createContainer(config(), { startTimers: false, ollama });
    await container.start();
    const close = vi.spyOn(container.handle, 'close');
    container.prepareShutdown();
    expect(ollama.stop).toHaveBeenCalledOnce();
    const stopping = container.stop();
    try {
      await Promise.resolve();
      expect(close).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await stopping;
    expect(close).toHaveBeenCalledOnce();
    expect(ollama.stop).toHaveBeenCalledOnce();
    await container.stop();
    expect(ollama.stop).toHaveBeenCalledOnce();
  });

  it('retains SQLite until a native service initialization already in progress has settled', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = SqliteOllamaRepository.prototype.read;
    const reading = vi
      .spyOn(SqliteOllamaRepository.prototype, 'read')
      .mockImplementation(async function (this: SqliteOllamaRepository, defaults) {
        await held;
        return read.call(this, defaults);
      });
    container = await createContainer(config(), { startTimers: false });
    const close = vi.spyOn(container.handle, 'close');
    const stopService = vi.spyOn(container.ollama, 'stop');
    await container.start();
    await vi.waitFor(() => expect(reading).toHaveBeenCalledOnce());
    const stopping = container.stop();
    try {
      await vi.waitFor(() => expect(stopService).toHaveBeenCalledOnce());
      const serviceStopped = stopService.mock.results[0]?.value as Promise<void>;
      expect(await Promise.race([serviceStopped.then(() => true), Promise.resolve(false)])).toBe(
        false,
      );
      expect(close).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await stopping;
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not restart discovery when shutdown was requested before storage startup', async () => {
    const ollama = services();
    container = await createContainer(config(), { startTimers: false, ollama });
    container.prepareShutdown();
    await container.start();
    expect(ollama.start).not.toHaveBeenCalled();
    expect(ollama.stop).toHaveBeenCalledOnce();
  });

  it('stops the service during failed-start teardown even before discovery was started', async () => {
    const ollama = services();
    container = await createContainer(config(), { startTimers: false, ollama });
    const cause = new Error('Chat setup failed');
    vi.spyOn(container.repos.chat, 'ensureGateway').mockRejectedValueOnce(cause);
    const close = vi.spyOn(container.handle, 'close');
    await expect(container.start()).rejects.toBe(cause);
    expect(ollama.start).not.toHaveBeenCalled();
    expect(ollama.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
