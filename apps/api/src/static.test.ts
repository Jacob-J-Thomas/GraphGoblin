import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createTestApp, type TestApp } from './testing/test-app.js';

let dist: string;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'gg-web-dist-'));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>GraphGoblin</title>');
  await writeFile(join(dist, 'sw.js'), 'self.addEventListener("install", () => {});');
  await writeFile(join(dist, 'manifest.webmanifest'), '{"name":"GraphGoblin"}');
  await writeFile(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
});

describe('loadConfig GG_WEB_DIST', () => {
  it('resolves the directory when set and omits it otherwise', () => {
    expect(loadConfig({ GG_WEB_DIST: 'web/dist' }).webDist).toBe(resolve('web/dist'));
    expect(loadConfig({}).webDist).toBeUndefined();
  });
});

describe('static web app hosting', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { GG_WEB_DIST: dist } });
  });
  afterAll(async () => {
    await t.close();
  });

  it('serves the shell at /app/ without caching', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/app/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toContain('GraphGoblin');
  });

  it('falls back to the shell for client-side routes', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/app/loops/01ABC/edit?tab=node' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>GraphGoblin</title>');
  });

  it('serves fingerprinted assets as immutable and the service worker as no-cache', async () => {
    const asset = await t.app.inject({ method: 'GET', url: '/app/assets/index-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    const sw = await t.app.inject({ method: 'GET', url: '/app/sw.js' });
    expect(sw.statusCode).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
    const icon = await t.app.inject({ method: 'GET', url: '/app/favicon.svg' });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['cache-control']).toBeUndefined();
  });

  it('answers a missing file with a 404 problem, not the shell', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/app/assets/missing.js' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe('NOT_FOUND');
  });

  it('redirects / and /app to /app/', async () => {
    for (const url of ['/', '/app']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(302);
      expect(res.headers['location']).toBe('/app/');
    }
  });

  it('leaves API routes and API 404s alone', async () => {
    const loops = await t.app.inject({ method: 'GET', url: '/loops' });
    expect(loops.statusCode).toBe(200);
    expect(loops.json<{ items: unknown[] }>().items).toEqual([]);
    const missing = await t.app.inject({ method: 'GET', url: '/runs/nope/unknown' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/problem+json');
  });

  it('keeps static routes out of the OpenAPI document', async () => {
    const doc = await t.app.inject({ method: 'GET', url: '/openapi.json' });
    const paths = Object.keys(doc.json<{ paths: Record<string, unknown> }>().paths);
    expect(paths.some((p) => p.startsWith('/app'))).toBe(false);
    expect(paths).not.toContain('/');
  });
});

describe('static web app with GG_REQUIRE_API_KEY=true', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { GG_WEB_DIST: dist }, requireApiKey: true });
  });
  afterAll(async () => {
    await t.close();
  });

  it('serves the shell, assets, and redirects without a key', async () => {
    for (const url of ['/app/', '/app/runs/01ABC', '/app/sw.js', '/app/assets/index-abc123.js']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
    for (const url of ['/', '/app']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(302);
    }
    expect((await t.app.inject({ method: 'GET', url: '/app/missing.js' })).statusCode).toBe(404);
  });

  it('keeps every API route guarded, including paths that try to escape /app/', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/loops' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/settings' })).statusCode).toBe(401);
    for (const url of ['/app/../loops', '/app/%2e%2e/loops', '/app/..%2floops']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.body, url).not.toContain('"items"');
    }
  });
});

describe('static hosting disabled', () => {
  it('does nothing without GG_WEB_DIST or when the directory has no build', async () => {
    for (const env of [{}, { GG_WEB_DIST: join(dist, 'does-not-exist') }]) {
      const t = await createTestApp({ env });
      try {
        const res = await t.app.inject({ method: 'GET', url: '/app/' });
        expect(res.statusCode).toBe(404);
      } finally {
        await t.close();
      }
    }
  });
});
