import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';

/** Where the web app is mounted. Its client-side routes live under it, never on API paths. */
export const WEB_PREFIX = '/app/';

/** Files that must be revalidated on every load so a new build is noticed (docs/09). */
const NO_CACHE = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'registerSW.js']);

function cacheHeaders(reply: FastifyReply, filePath: string): void {
  const name = basename(filePath);
  if (NO_CACHE.has(name)) {
    reply.header('cache-control', 'no-cache');
  } else if (/[\\/]assets[\\/]/.test(filePath)) {
    // Vite fingerprints everything under assets/, so it can be cached forever.
    reply.header('cache-control', 'public, max-age=31536000, immutable');
  }
}

/**
 * Serve the built web app (`GG_WEB_DIST`) under `/app/` with an SPA fallback: any `/app/...` path
 * that is not a file and has no extension answers with `index.html`, so client-side routes survive
 * a reload. `/` and `/app` redirect to `/app/`. API routes are untouched. Does nothing when the
 * directory does not exist, so the API runs without a web build.
 */
export async function registerStatic(
  app: FastifyInstance,
  webDist: string | undefined,
): Promise<void> {
  if (!webDist || !existsSync(join(webDist, 'index.html'))) return;

  await app.register(async (scope) => {
    await scope.register(fastifyStatic, {
      root: webDist,
      prefix: WEB_PREFIX,
      wildcard: false,
      index: false,
      cacheControl: false,
      setHeaders: cacheHeaders,
      schemaHide: true,
    });

    const sendShell = (reply: FastifyReply) => {
      reply.header('cache-control', 'no-cache');
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    };

    scope.get(WEB_PREFIX, { schema: { hide: true } }, (_request, reply) => sendShell(reply));
    scope.get(`${WEB_PREFIX}*`, { schema: { hide: true } }, (request, reply) => {
      const path = (request.url.split('?')[0] ?? '').slice(WEB_PREFIX.length);
      const last = path.split('/').pop() ?? '';
      // A missing asset is a 404, not the shell; only extension-less paths are client routes.
      if (last.includes('.')) return reply.callNotFound();
      return sendShell(reply);
    });
    scope.get('/app', { schema: { hide: true } }, (_request, reply) => reply.redirect(WEB_PREFIX));
    scope.get('/', { schema: { hide: true } }, (_request, reply) => reply.redirect(WEB_PREFIX));
  });
}
