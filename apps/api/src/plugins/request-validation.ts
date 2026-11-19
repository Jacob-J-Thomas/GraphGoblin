import type { FastifySchemaCompiler, FastifySchemaValidationError } from 'fastify';
import { toUSVString } from 'node:util';
import type { z } from 'zod';

const requestValidationIssue = Symbol('owned request validation issue');
type RequestValidationIssue = FastifySchemaValidationError & {
  [requestValidationIssue]: true;
};

const pointerSegment = (segment: PropertyKey) =>
  String(segment).replaceAll('~', '~0').replaceAll('/', '~1');

/** Encode original segments once here; a slash-joined provider string is irreversible. */
export const requestValidatorCompiler: FastifySchemaCompiler<z.ZodType> =
  ({ schema }) =>
  (data) => {
    const parsed = schema.safeParse(data);
    if (parsed.success) return { value: parsed.data };
    return {
      error: parsed.error.issues.map(
        ({ code, path, message, ...params }): RequestValidationIssue => {
          const encoded = path.map(pointerSegment);
          return {
            [requestValidationIssue]: true,
            keyword: code,
            // Keep the API's existing root '/' convention.
            instancePath: '/' + encoded.join('/'),
            schemaPath:
              '#/' +
              [...encoded, pointerSegment(code)]
                .map((segment) => encodeURIComponent(toUSVString(segment)))
                .join('/'),
            message,
            params,
          };
        },
      ),
    };
  };

function isRequestValidationIssue(value: unknown): value is RequestValidationIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    requestValidationIssue in value &&
    value[requestValidationIssue] === true
  );
}

export function hasRequestSchemaValidationErrors(
  error: unknown,
): error is Error & { validation: RequestValidationIssue[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Array.isArray(error.validation) &&
    error.validation.length > 0 &&
    error.validation.every(isRequestValidationIssue)
  );
}
