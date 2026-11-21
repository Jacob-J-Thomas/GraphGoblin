import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '@graphgoblin/engine';
import type { Container } from '../container.js';
import { LOCAL_OWNER } from '../container.js';
import { problem } from './errors.js';
import { createHash } from 'node:crypto';

export interface AuthContext {
  ownerId: string;
  actor: Actor;
  scopes: string[] | '*';
  /** Device credentials have no owner API-key scopes or management authority. */
  deviceId?: string;
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
const PUBLIC_PREFIXES = [
  '/healthz',
  '/version',
  '/openapi.json',
  '/docs',
  '/hooks/',
  '/app/',
  '/goblin/',
];
const PUBLIC_EXACT = new Set(['/', '/app', '/goblin']);

/** Method and registered pattern must both match; a prefix never grants device authority. */
export const DEVICE_CHAT_ROUTES = new Set([
  'GET /chat/session',
  'POST /chat/conversations',
  'GET /chat/conversations',
  'GET /chat/conversations/:id/turns',
  'POST /chat/conversations/:id/turns',
  'GET /chat/conversations/:id/requests/:requestId',
  'GET /chat/turns/:id',
  'POST /chat/turns/:id/cancel',
  'POST /chat/audio',
  'GET /chat/audio/requests/:uploadId',
  'DELETE /chat/audio/:id',
]);

const OWNER_CHAT_ROUTES = new Set([
  'PUT /harness/ollama/connection',
  'POST /chat/pairings',
  'GET /chat/pairings/readiness',
  'GET /chat/voice/config',
  'PUT /chat/voice/config',
  'POST /chat/voice/probe',
  'POST /chat/voice/preview',
  'POST /chat/voice/install',
  'GET /chat/voice/loops',
  'POST /chat/voice/stage',
  'GET /chat/voice/probes/:operationId',
  'GET /chat/voice/installs/:operationId',
  'GET /chat/devices',
  'PATCH /chat/devices/:id',
  'POST /chat/devices/:id/revoke',
]);

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
  'GET /harness/ollama/connection': 'settings:read',
  'GET /chat/voice/config': 'settings:read',
  'PUT /chat/voice/config': 'settings:write',
  'POST /chat/voice/probe': 'settings:write',
  'POST /chat/voice/preview': 'settings:write',
  'POST /chat/voice/install': 'settings:write',
  'GET /chat/voice/loops': 'settings:read',
  'POST /chat/voice/stage': 'settings:write',
  'GET /chat/voice/probes/:operationId': 'settings:read',
  'GET /chat/voice/installs/:operationId': 'settings:read',
  'POST /model-catalog/refresh': 'settings:write',
  'POST /runs/deletion-eligibility/preview': 'runs:read',
  // Starting a run is a run command, even though it is addressed through its loop.
  'POST /loops/:id/runs': 'runs:write',
  // Validation reads the loop and saves nothing.
  'POST /loops/:id/validate': 'loops:read',
  // Preview computes slots without saving or arming a schedule.
  'POST /triggers/cron/preview': 'loops:read',
};

/** Path segments that share another resource's scope. */
const SCOPE_RESOURCE_ALIASES: Record<string, string> = {
  templates: 'loops',
  'model-catalog': 'settings',
  'classifier-models': 'settings',
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
    if ((request.url.split('?')[0] ?? '').startsWith('/chat/'))
      reply.header('cache-control', 'no-store');
    const route = `${request.method} ${request.routeOptions.url ?? ''}`;
    const header = request.headers.authorization;
    const match = header ? /^Bearer\s+(.+)$/i.exec(header) : undefined;
    const token = match?.[1]?.trim();
    if (token?.startsWith('ggd_')) {
      const identity = /^ggd_[A-Za-z0-9_-]{43}$/.test(token)
        ? await container.repos.chat.authenticateDevice(
            createHash('sha256').update(token).digest('hex'),
          )
        : undefined;
      if (!identity)
        return problem(reply, 401, 'UNAUTHORIZED', 'the device credential is invalid or revoked');
      if (!DEVICE_CHAT_ROUTES.has(route))
        return problem(reply, 403, 'FORBIDDEN', 'device credentials cannot access this route');
      request.auth = {
        ownerId: identity.ownerId,
        actor: { kind: 'system', id: `chat-device:${identity.device.id}` },
        scopes: [],
        deviceId: identity.device.id,
      };
      return;
    }
    const publicRoute = isPublic(request.url) || route === 'POST /chat/pairings/claim';
    if (publicRoute && !header) {
      request.auth = { ownerId: LOCAL_OWNER, actor: { kind: 'system', id: 'public' }, scopes: [] };
      return;
    }
    if (header) {
      const record = token ? await container.repos.apiKeys.authenticate(token) : undefined;
      if (!record) {
        return problem(reply, 401, 'UNAUTHORIZED', 'the API key is missing, malformed, or revoked');
      }
      request.auth = {
        ownerId: record.ownerId,
        actor: { kind: 'api-key', id: record.id },
        scopes: record.scopes,
      };
      if (OWNER_CHAT_ROUTES.has(route) && !hasScope(record.scopes, '*'))
        return problem(reply, 403, 'FORBIDDEN', 'this operation requires a wildcard owner key');
      if (publicRoute) return;
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
