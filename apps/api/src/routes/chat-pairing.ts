import { createHash, randomBytes } from 'node:crypto';
import {
  ChatDeviceSchema,
  ChatPairClaimRequestSchema,
  ChatPairClaimResponseSchema,
  ChatPairingCreatedSchema,
  ChatPairingReadinessSchema,
  type ChatPairingReadiness,
  UlidSchema,
} from '@graphgoblin/contracts';
import { systemChatIssues } from '@graphgoblin/domain';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { ApiInstance } from '../types.js';
import { ChatError } from '../chat/errors.js';
import { ChatService } from '../chat/service.js';
import { problem } from '../plugins/errors.js';
import { FixedWindowRateLimiter } from '../triggers/rate-limit.js';

const IdParams = z.strictObject({ id: UlidSchema });
const EmptyBody = z.strictObject({}).default({});
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** Enrollment links use configured authority only, never Host or forwarded headers. */
export function pairingBaseUrl(publicUrl: string | undefined): URL | undefined {
  if (!publicUrl) return undefined;
  try {
    const url = new URL(publicUrl);
    if (url.username || url.password || url.search || url.hash) return undefined;
    const loopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined;
    return new URL('/goblin/', url);
  } catch {
    return undefined;
  }
}

export function registerChatPairingRoutes(app: ApiInstance, container: Container): void {
  const { chat } = container.repos;
  const service = new ChatService(container);
  const claims = new FixedWindowRateLimiter(container.ports.clock, 10);
  const globalClaims = new FixedWindowRateLimiter(container.ports.clock, 100);
  app.addHook('onRequest', async (request, reply) => {
    if (`${request.method} ${request.routeOptions.url ?? ''}` !== 'POST /chat/pairings/claim')
      return;
    const global = globalClaims.hit('all');
    const decisions = global.allowed ? [global, claims.hit(request.ip)] : [global];
    const denied = decisions.find((decision) => !decision.allowed);
    if (!denied) return;
    reply.header('retry-after', denied.retryAfterSeconds);
    return problem(
      reply,
      429,
      'RATE_LIMITED',
      'too many chat requests; retry after the indicated delay',
    );
  });

  const readiness = async (
    auth: Parameters<ChatService['published']>[0],
  ): Promise<ChatPairingReadiness> => {
    if (!container.config.requireApiKey)
      return {
        ready: false,
        mode: 'unavailable',
        code: 'CHAT_PAIRING_AUTH_REQUIRED',
        message:
          'Enable required owner authentication (GG_REQUIRE_API_KEY=true), then restart the gateway before pairing.',
      };
    let url: URL | undefined;
    if (container.config.publicUrl !== undefined) {
      url = pairingBaseUrl(container.config.publicUrl);
      if (!url)
        return {
          ready: false,
          mode: 'unavailable',
          code: 'CHAT_PAIRING_ADDRESS_INVALID',
          message:
            'Set GG_PUBLIC_URL to a valid HTTPS gateway address for home Wi-Fi, or a loopback HTTP address for this computer only. Remove credentials, queries and fragments, then restart the gateway.',
        };
    } else {
      const listener = app.server.address();
      const host = container.config.host;
      const loopback = (value: string) =>
        ['localhost', '127.0.0.1', '::1', '[::1]'].includes(value);
      if (
        !loopback(host) ||
        !listener ||
        typeof listener === 'string' ||
        !loopback(listener.address)
      )
        return {
          ready: false,
          mode: 'unavailable',
          code: 'CHAT_PAIRING_ADDRESS_REQUIRED',
          message:
            'For home Wi-Fi, configure GG_PUBLIC_URL with a reachable HTTPS address and a certificate trusted by the device. This computer can pair without a public address when the gateway listens only on loopback.',
        };
      const authority = host === '::1' || host === '[::1]' ? '[::1]' : host;
      url = new URL(`http://${authority}:${listener.port}/goblin/`);
    }
    try {
      const { version } = await service.published(auth);
      if (systemChatIssues(version.definition).length)
        throw new ChatError(
          'CHAT_NOT_READY',
          409,
          'Publish a contract-valid gateway chat loop before pairing.',
        );
    } catch (error) {
      if (!(error instanceof ChatError)) throw error;
      return { ready: false, mode: 'unavailable', code: error.code, message: error.message };
    }
    const sameMachine = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return {
      ready: true,
      mode: sameMachine ? 'same-machine' : 'network',
      url: url.toString(),
      message: sameMachine
        ? 'This computer only. Open the link in a new tab, another browser or the installed Goblin app on this computer. A phone needs a reachable HTTPS gateway address.'
        : 'Open this HTTPS address on the device first and confirm that its certificate is trusted. Pairing availability does not verify model or voice readiness.',
    };
  };

  app.get(
    '/chat/pairings/readiness',
    {
      schema: {
        tags: ['chat'],
        summary: 'Check owner-only device enrollment prerequisites without creating a code',
        response: { 200: ChatPairingReadinessSchema },
      },
    },
    (request) => readiness(request.auth),
  );

  app.post(
    '/chat/pairings',
    {
      schema: {
        tags: ['chat'],
        summary: 'Create a ten-minute device enrollment',
        body: EmptyBody,
        response: { 201: ChatPairingCreatedSchema },
      },
    },
    async (request, reply) => {
      const state = await readiness(request.auth);
      if (!state.ready || !state.url)
        throw new ChatError(
          'CHAT_PAIRING_UNAVAILABLE',
          409,
          state.message ?? 'Pairing is unavailable.',
        );
      const url = new URL(state.url);
      const code = randomBytes(32).toString('base64url');
      const expiresAt = new Date(container.ports.clock.now().getTime() + 10 * 60_000).toISOString();
      const pairing = await chat.createPairing(request.auth.ownerId, hash(code), expiresAt);
      url.hash = `pair=${encodeURIComponent(code)}`;
      reply.status(201);
      return { ...pairing, code, url: url.toString() };
    },
  );

  app.post(
    '/chat/pairings/claim',
    {
      schema: {
        tags: ['chat'],
        summary: 'Claim an enrollment idempotently with a client-generated credential',
        security: [],
        body: ChatPairClaimRequestSchema,
        response: { 200: ChatPairClaimResponseSchema },
      },
    },
    async (request) => {
      if (!container.config.requireApiKey)
        throw new ChatError('CHAT_PAIRING_UNAVAILABLE', 409, 'peripheral onboarding is disabled');
      const device = await chat.claimPairing({
        codeHash: hash(request.body.code),
        claimId: request.body.claimId,
        tokenHash: hash(request.body.deviceToken),
        label: request.body.label,
      });
      return { deviceId: device.id, label: device.label };
    },
  );

  app.get(
    '/chat/devices',
    {
      schema: {
        tags: ['chat'],
        summary: 'List paired devices and their editable system loops',
        response: { 200: z.strictObject({ items: z.array(ChatDeviceSchema) }) },
      },
    },
    async (request) => ({ items: await chat.listDevices(request.auth.ownerId) }),
  );

  app.patch(
    '/chat/devices/:id',
    {
      schema: {
        tags: ['chat'],
        summary: 'Rename a device',
        params: IdParams,
        body: ChatDeviceSchema.pick({ label: true }),
        response: { 200: ChatDeviceSchema },
      },
    },
    (request) => chat.updateDevice(request.auth.ownerId, request.params.id, request.body.label),
  );

  app.post(
    '/chat/devices/:id/revoke',
    {
      schema: {
        tags: ['chat'],
        summary: 'Revoke future device access while retaining its loop and history',
        params: IdParams,
        body: EmptyBody,
        response: { 200: ChatDeviceSchema },
      },
    },
    (request) => chat.revokeDevice(request.auth.ownerId, request.params.id),
  );
}
