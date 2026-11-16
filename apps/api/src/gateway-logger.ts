import type { FastifyBaseLogger } from 'fastify';
import { pino, type DestinationStream, type Logger } from 'pino';
import type { ApiConfig } from './config.js';

const METHOD = /^[A-Z]{1,16}$/;
/** Node's error codes, such as `HPE_INVALID_HEADER_TOKEN`; never request text. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

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

/** The parts of Node's `net.Socket` a client-error handler uses. */
export interface ClientSocket {
  readonly destroyed: boolean;
  readonly writable: boolean;
  write(data: string): unknown;
  destroy(error?: Error): unknown;
}

interface ClientErrorOutcome {
  label: string;
  statusCode: number;
  reason: string;
  message: string;
}

/** Fastify's default client-error outcomes: log label, status, reason phrase and body message. */
function clientErrorOutcome(code: unknown): ClientErrorOutcome {
  switch (code) {
    case 'ERR_HTTP_REQUEST_TIMEOUT':
      return {
        label: 'timeout',
        statusCode: 408,
        reason: 'Request Timeout',
        message: 'Client Timeout',
      };
    case 'HPE_HEADER_OVERFLOW':
      return {
        label: 'header_overflow',
        statusCode: 431,
        reason: 'Request Header Fields Too Large',
        message: 'Exceeded maximum allowed HTTP header size',
      };
    default:
      return { label: 'error', statusCode: 400, reason: 'Bad Request', message: 'Client Error' };
  }
}

/**
 * Managed-mode `clientErrorHandler` (#438). Node reports a malformed request or connection error
 * before Fastify has a request, with the parser's raw packet on the error; Fastify's default
 * handler logs that error at trace through Pino's standard `err` serializer, which copies it.
 * This keeps the default's response, status and socket closure and records only the fixed
 * outcome, the status and Node's error code, never the error's message, packet bytes or headers.
 */
export function managedClientErrorHandler(
  this: { log: Pick<FastifyBaseLogger, 'trace'> },
  error: Error & { code?: unknown },
  socket: ClientSocket,
): void {
  // A reset or already destroyed connection has nothing to answer, as in Fastify's default.
  if (error.code === 'ECONNRESET' || socket.destroyed) return;
  const { label, statusCode, reason, message } = clientErrorOutcome(error.code);
  const code = typeof error.code === 'string' && ERROR_CODE.test(error.code) ? error.code : null;
  this.log.trace({ clientError: { statusCode, ...(code ? { code } : {}) } }, `client ${label}`);
  if (socket.writable) {
    const body = JSON.stringify({ error: reason, message, statusCode });
    socket.write(
      `HTTP/1.1 ${statusCode} ${reason}\r\nContent-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n${body}`,
    );
  }
  socket.destroy(error);
}

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
