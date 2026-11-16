import { pino, type DestinationStream, type Logger } from 'pino';
import type { ApiConfig } from './config.js';

const METHOD = /^[A-Z]{1,16}$/;

interface RequestLike {
  method?: unknown;
  routeOptions?: { url?: unknown };
}
interface ReplyLike {
  statusCode?: unknown;
  request?: RequestLike;
}

/** Method and registered route template only; never the raw URL, query, headers or body. */
function accessFields(request: RequestLike | undefined): { method?: string; route?: string } {
  const method = request?.method;
  const route = request?.routeOptions?.url;
  return {
    ...(typeof method === 'string' && METHOD.test(method) ? { method } : {}),
    ...(typeof route === 'string' ? { route } : {}),
  };
}

/**
 * Managed-mode access projection (#438). Fastify logs `{ req: request }` and `{ res: reply }`;
 * these replace its defaults, which include the raw URL, Accept-Version, host and peer address.
 */
export const managedAccessSerializers = {
  req: (request: RequestLike) => accessFields(request),
  res: (reply: ReplyLike) => ({
    ...accessFields(reply?.request),
    ...(typeof reply?.statusCode === 'number' ? { statusCode: reply.statusCode } : {}),
  }),
};

/**
 * The gateway's Pino logger. A shell keeps Pino's default stdout configuration. The Windows
 * launcher's detached gateway writes the same private engine diagnostics to the bounded
 * destination, with access records narrowed to method, route template and status.
 */
export function createGatewayLogger(config: ApiConfig, destination?: DestinationStream): Logger {
  return destination
    ? pino({ level: config.logLevel, serializers: managedAccessSerializers }, destination)
    : pino({ level: config.logLevel });
}
