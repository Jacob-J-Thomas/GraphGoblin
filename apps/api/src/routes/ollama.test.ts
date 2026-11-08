import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OllamaConnectionView } from '@graphgoblin/contracts';
import { registerOllamaRoutes } from './ollama.js';
import type { ApiInstance } from '../types.js';

const view: OllamaConnectionView = {
  connection: { enabled: true, baseUrl: 'http://127.0.0.1:11434', revision: 1 },
  discovery: { state: 'ready', lastSuccessAt: '2026-11-07T12:00:00.000Z' },
};
const apps: ApiInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup() {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  apps.push(app);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const ollama = {
    view: vi.fn().mockResolvedValue(view),
    configure: vi.fn().mockResolvedValue(view),
    refresh: vi.fn().mockResolvedValue(view.discovery),
  };
  registerOllamaRoutes(app, { ollama });
  return { app, ollama };
}

describe('Ollama connection and discovery routes', () => {
  it('reads the connection and delegates exactly one explicit refresh', async () => {
    const { app, ollama } = setup();
    expect((await app.inject('/harness/ollama/connection')).json()).toEqual(view);
    const response = await app.inject({
      method: 'POST',
      url: '/model-catalog/refresh',
      payload: { harness: 'ollama' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(view.discovery);
    expect(ollama.view).toHaveBeenCalledExactlyOnceWith();
    expect(ollama.refresh).toHaveBeenCalledExactlyOnceWith();
    expect(ollama.configure).not.toHaveBeenCalled();
  });

  it('returns a saved connection even when its immediate discovery failed', async () => {
    const { app, ollama } = setup();
    const saved = {
      connection: { enabled: true, baseUrl: 'https://models.example.test', revision: 2 },
      discovery: {
        state: 'error',
        error: { code: 'OLLAMA_UNAVAILABLE', message: 'Cannot reach the Ollama service.' },
      },
    };
    ollama.configure.mockResolvedValue(saved);
    const input = { enabled: true, baseUrl: 'https://models.example.test' };
    const response = await app.inject({
      method: 'PUT',
      url: '/harness/ollama/connection',
      payload: input,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(saved);
    expect(ollama.configure).toHaveBeenCalledExactlyOnceWith(input);
    expect(ollama.refresh).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { enabled: true },
    { enabled: 'true', baseUrl: 'http://localhost:11434' },
    { enabled: true, baseUrl: 'http://user:secret@localhost:11434' },
    { enabled: true, baseUrl: 'http://localhost:11434/api' },
    { enabled: true, baseUrl: 'http://localhost:11434?token=secret' },
    { enabled: true, baseUrl: 'http://localhost:11434#token' },
    { enabled: true, baseUrl: 'file:///tmp/model' },
    { enabled: true, baseUrl: 'http://localhost:11434', ownerId: 'other' },
  ])('refuses invalid connection %j before the service', async (payload) => {
    const { app, ollama } = setup();
    expect(
      (await app.inject({ method: 'PUT', url: '/harness/ollama/connection', payload })).statusCode,
    ).toBe(400);
    expect(ollama.configure).not.toHaveBeenCalled();
  });

  it.each([{}, { harness: 'codex' }, { harness: 'ollama', baseUrl: 'https://other.test' }])(
    'refuses a refresh outside the configured Ollama connection: %j',
    async (payload) => {
      const { app, ollama } = setup();
      expect(
        (await app.inject({ method: 'POST', url: '/model-catalog/refresh', payload })).statusCode,
      ).toBe(400);
      expect(ollama.refresh).not.toHaveBeenCalled();
    },
  );
});
