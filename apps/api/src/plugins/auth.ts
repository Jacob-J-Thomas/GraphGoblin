import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '@graphgoblin/engine';
import type { Container } from '../container.js';
import { LOCAL_OWNER } from '../container.js';
import { problem } from './errors.js';

export interface AuthContext {
  ownerId: string;
  actor: Actor;
  scopes: string[] | '*';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

/** Routes that never require credentials: health, docs, and the signed webhook receivers (docs/08). */
const PUBLIC_PREFIXES = ['/healthz', '/version', '/openapi.json', '/docs', '/hooks/'];

function isPublic(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PREFIXES.some(
    (prefix) =>
      path === prefix ||
      path === `${prefix}/` ||
      (prefix.endsWith('/') ? path.startsWith(prefix) : path.startsWith(`${prefix}/`)),
  );
}

/**
 * Local trusted mode plus API keys (docs/07). Without a key and with `requireApiKey` off, the
 * request acts as the local owner. A presented key must resolve, or the request is rejected even
 * in local mode so a wrong key never silently falls back to local access.
 */
export function registerAuth(app: FastifyInstance, container: Container): void {
  app.decorateRequest('auth', null as unknown as AuthContext);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublic(request.url)) {
      request.auth = { ownerId: LOCAL_OWNER, actor: { kind: 'system', id: 'public' }, scopes: [] };
      return;
    }
    const header = request.headers.authorization;
    if (header) {
      const match = /^Bearer\s+(.+)$/i.exec(header);
      const token = match?.[1]?.trim();
      const record = token ? await container.repos.apiKeys.authenticate(token) : undefined;
      if (!record) {
        return problem(reply, 401, 'UNAUTHORIZED', 'the API key is missing, malformed, or revoked');
      }
      request.auth = {
        ownerId: record.ownerId,
        actor: { kind: 'api-key', id: record.id },
        scopes: record.scopes,
      };
      return;
    }
    if (container.config.requireApiKey) {
      return problem(reply, 401, 'UNAUTHORIZED', 'an API key is required');
    }
    request.auth = { ownerId: LOCAL_OWNER, actor: { kind: 'user', id: LOCAL_OWNER }, scopes: '*' };
  });
}

/** Scope check for routes that need one. `*` (local mode) passes everything. */
export function requireScope(request: FastifyRequest, reply: FastifyReply, scope: string): boolean {
  if (
    request.auth.scopes === '*' ||
    request.auth.scopes.includes(scope) ||
    request.auth.scopes.includes('*')
  )
    return true;
  void problem(reply, 403, 'FORBIDDEN', `this key lacks the "${scope}" scope`);
  return false;
}
