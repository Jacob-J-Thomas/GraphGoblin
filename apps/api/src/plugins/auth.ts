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

/**
 * Routes that never require credentials: health, docs, the signed webhook receivers (docs/08), and
 * the static web app under `/app/` with its `/` and `/app` redirects. The app shell holds no data;
 * every API call it makes is still authenticated.
 */
const PUBLIC_PREFIXES = ['/healthz', '/version', '/openapi.json', '/docs', '/hooks/', '/app/'];
const PUBLIC_EXACT = new Set(['/', '/app']);

function isPublic(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) =>
      path === prefix ||
      path === `${prefix}/` ||
      (prefix.endsWith('/') ? path.startsWith(prefix) : path.startsWith(`${prefix}/`)),
  );
}

/**
 * Routes whose scope is not `<first path segment>:<read|write>` by method. Keys are
 * `METHOD route-pattern`, as Fastify registers the route.
 */
const SCOPE_OVERRIDES: Record<string, string> = {
  // Starting a run is a run command, even though it is addressed through its loop.
  'POST /loops/:id/runs': 'runs:write',
  // Validation reads the loop and saves nothing.
  'POST /loops/:id/validate': 'loops:read',
};

/** Path segments that share another resource's scope. */
const SCOPE_RESOURCE_ALIASES: Record<string, string> = {
  'model-catalog': 'settings',
  harness: 'system',
};

/**
 * The scope a private route needs (docs/07): an explicit override, otherwise the route's first
 * path segment (through the aliases) with `read` for GET and HEAD and `write` for everything
 * else. Undefined for a request that matched no route, which then gets its 404.
 */
export function requiredScope(method: string, routeUrl: string | undefined): string | undefined {
  if (!routeUrl) return undefined;
  const override = SCOPE_OVERRIDES[`${method} ${routeUrl}`];
  if (override) return override;
  const segment = routeUrl.split('/')[1] ?? '';
  const resource = SCOPE_RESOURCE_ALIASES[segment] ?? segment;
  return `${resource}:${method === 'GET' || method === 'HEAD' ? 'read' : 'write'}`;
}

/** `*` grants everything; `<resource>:write` implies `<resource>:read`. */
export function hasScope(scopes: AuthContext['scopes'], scope: string): boolean {
  if (scopes === '*' || scopes.includes('*') || scopes.includes(scope)) return true;
  return scope.endsWith(':read') && scopes.includes(`${scope.slice(0, -':read'.length)}:write`);
}

/**
 * Local trusted mode plus API keys (docs/07). Without a key and with `requireApiKey` off, the
 * request acts as the local owner. A presented key must resolve, or the request is rejected even
 * in local mode so a wrong key never silently falls back to local access. A key must also hold
 * the route's scope (`requiredScope`); that is checked here, before the body is parsed or any
 * data is read, so every route, read or write, is covered by one policy.
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
      const scope = requiredScope(request.method, request.routeOptions.url);
      if (scope && !hasScope(record.scopes, scope)) {
        return problem(reply, 403, 'FORBIDDEN', `this key lacks the "${scope}" scope`);
      }
      return;
    }
    if (container.config.requireApiKey) {
      return problem(reply, 401, 'UNAUTHORIZED', 'an API key is required');
    }
    request.auth = { ownerId: LOCAL_OWNER, actor: { kind: 'user', id: LOCAL_OWNER }, scopes: '*' };
  });
}
