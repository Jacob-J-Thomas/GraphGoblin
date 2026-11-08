import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';

/** Where the web app is mounted. Its client-side routes live under it, never on API paths. */
export const WEB_PREFIX = '/app/';
export const GOBLIN_PREFIX = '/goblin/';

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
  goblinDist?: string,
): Promise<void> {
  await registerShell(app, webDist, WEB_PREFIX, true);
  await registerShell(app, goblinDist, GOBLIN_PREFIX, false);
}

async function registerShell(
  app: FastifyInstance,
  dist: string | undefined,
  prefix: string,
  redirectRoot: boolean,
): Promise<void> {
  if (!dist || !existsSync(join(dist, 'index.html'))) return;

  await app.register(async (scope) => {
    await scope.register(fastifyStatic, {
      root: dist,
      prefix,
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

    scope.get(prefix, { schema: { hide: true } }, (_request, reply) => sendShell(reply));
    scope.get(`${prefix}*`, { schema: { hide: true } }, (request, reply) => {
      const path = (request.url.split('?')[0] ?? '').slice(prefix.length);
      const last = path.split('/').pop() ?? '';
      // A missing asset is a 404, not the shell; only extension-less paths are client routes.
      if (last.includes('.')) return reply.callNotFound();
      return sendShell(reply);
    });
    scope.get(prefix.slice(0, -1), { schema: { hide: true } }, (_request, reply) =>
      reply.redirect(prefix),
    );
    if (redirectRoot)
      scope.get('/', { schema: { hide: true } }, (_request, reply) => reply.redirect(prefix));
  });
}
