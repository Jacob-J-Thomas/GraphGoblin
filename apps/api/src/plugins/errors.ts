import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoopNotFoundError } from '@graphgoblin/infrastructure/sqlite';
import { DomainError } from '@graphgoblin/domain';
import { EngineRequestError } from '@graphgoblin/engine';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

/** RFC 9457 Problem Details with a stable machine-readable `code`. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  errors?: unknown;
}

export function problem(
  reply: FastifyReply,
  status: number,
  code: string,
  detail?: string,
  errors?: unknown,
): FastifyReply {
  const body: ProblemDetails = {
    type: `https://graphgoblin.dev/problems/${code.toLowerCase().replace(/_/g, '-')}`,
    title: code.replace(/_/g, ' ').toLowerCase(),
    status,
    code,
    ...(detail ? { detail } : {}),
    ...(errors !== undefined ? { errors } : {}),
  };
  return reply.status(status).type('application/problem+json').send(body);
}

const ENGINE_STATUS: Record<EngineRequestError['code'], number> = {
  LOOP_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  TRIGGER_NOT_FOUND: 404,
  VERSION_NOT_PUBLISHED: 409,
  INVALID_STATE: 409,
  INVALID_INPUT: 400,
};

/**
 * Stable codes for the request errors Fastify raises itself, so clients never see framework
 * internals such as `FST_ERR_CTP_INVALID_JSON_BODY` in a problem's `code` or `type`.
 */
const FASTIFY_CODES: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'MALFORMED_BODY',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'MALFORMED_BODY',
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: 'MALFORMED_BODY',
  FST_ERR_CTP_BODY_TOO_LARGE: 'BODY_TOO_LARGE',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  FST_ERR_CTP_INVALID_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
};

function stableCode(code: string | undefined): string {
  if (!code) return 'BAD_REQUEST';
  return FASTIFY_CODES[code] ?? (code.startsWith('FST_') ? 'BAD_REQUEST' : code);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    problem(reply, 404, 'NOT_FOUND', `${request.method} ${request.url} does not exist`),
  );

  app.setErrorHandler(
    (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
      if (hasZodFastifySchemaValidationErrors(error)) {
        return problem(
          reply,
          400,
          'VALIDATION_FAILED',
          'the request did not match the schema',
          error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        );
      }
      if (isResponseSerializationError(error)) {
        request.log.error({ err: error }, 'response failed schema validation');
        return problem(
          reply,
          500,
          'RESPONSE_INVALID',
          'the server produced a response that does not match its schema',
        );
      }
      if (error instanceof EngineRequestError) {
        return problem(reply, ENGINE_STATUS[error.code], error.code, error.message, error.details);
      }
      if (error instanceof LoopNotFoundError) {
        return problem(reply, 404, 'LOOP_NOT_FOUND', error.message);
      }
      if (error instanceof DomainError) {
        return problem(reply, 400, error.code, error.message, error.details);
      }
      const fastifyError = error as FastifyError;
      if (
        typeof fastifyError.statusCode === 'number' &&
        fastifyError.statusCode >= 400 &&
        fastifyError.statusCode < 500
      ) {
        return problem(
          reply,
          fastifyError.statusCode,
          stableCode(fastifyError.code),
          error.message,
        );
      }
      request.log.error({ err: error }, 'unhandled error');
      return problem(reply, 500, 'INTERNAL_ERROR', 'something went wrong on the server');
    },
  );
}
