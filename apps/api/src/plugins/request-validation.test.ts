import Fastify from 'fastify';
import { serializerCompiler } from 'fastify-type-provider-zod';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { registerErrorHandler } from './errors.js';
import {
  hasRequestSchemaValidationErrors,
  requestValidatorCompiler,
} from './request-validation.js';

async function fixture(schema: z.ZodType) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(requestValidatorCompiler);
  registerErrorHandler(app);
  app.post('/fixture', { schema: { body: schema } }, (request) => request.body);
  await app.ready();
  return app;
}

it('encodes literal containing keys, array indexes and unknown members from structured paths', async () => {
  const app = await fixture(
    z.record(
      z.string(),
      z.strictObject({
        count: z.number(),
        items: z.array(z.strictObject({ value: z.number() })).optional(),
      }),
    ),
  );
  try {
    for (const [payload, path, message] of [
      [
        { 'scope/a~1b': { count: 'bad' } },
        '/scope~1a~01b/count',
        'Invalid input: expected number, received string',
      ],
      [
        { 'scope/a~1b': { count: 1, items: [{ value: 0 }, { value: 'bad' }] } },
        '/scope~1a~01b/items/1/value',
        'Invalid input: expected number, received string',
      ],
      [
        { 'scope/a~1b': { count: 1, 'extra/~field': true } },
        '/scope~1a~01b/extra~1~0field',
        'Unrecognized key "extra/~field"',
      ],
    ] as const) {
      const response = await app.inject({ method: 'POST', url: '/fixture', payload });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ path, message }],
      });
    }
  } finally {
    await app.close();
  }
});

it('keeps ordinary and root diagnostics and the parsed success value without duplicate validation', async () => {
  let calls = 0;
  const app = await fixture(
    z.strictObject({
      count: z
        .number()
        .transform((value) => {
          calls++;
          return value;
        })
        .refine((value) => value > 0, 'must be positive'),
      enabled: z.boolean().default(false),
    }),
  );
  try {
    const failed = await app.inject({ method: 'POST', url: '/fixture', payload: { count: 0 } });
    expect(failed.json()).toMatchObject({
      errors: [{ path: '/count', message: 'must be positive' }],
    });
    expect(calls).toBe(1);
    const success = await app.inject({ method: 'POST', url: '/fixture', payload: { count: 2 } });
    expect(success.json()).toEqual({ count: 2, enabled: false });
    expect(calls).toBe(2);
    const root = await app.inject({ method: 'POST', url: '/fixture', payload: [] });
    expect(root.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: '/', message: 'Invalid input: expected object, received array' }],
    });
  } finally {
    await app.close();
  }
});

it('does not classify unrelated or empty errors as owned request-schema errors', () => {
  for (const value of [null, undefined, 0, 'failure', {}, { validation: [] }, { validation: [{}] }])
    expect(hasRequestSchemaValidationErrors(value)).toBe(false);
});

it('builds instance and schema paths from the same literal segments', async () => {
  const validate = requestValidatorCompiler({
    schema: z.record(z.string(), z.number()),
    method: 'POST',
    url: '/fixture',
    httpPart: 'body',
  });
  expect(await validate({ 'scope /~': 'bad' })).toMatchObject({
    error: [
      {
        instancePath: '/scope ~1~0',
        schemaPath: '#/scope%20~1~0/invalid_type',
        keyword: 'invalid_type',
        message: 'Invalid input: expected number, received string',
      },
    ],
  });
  // A JSON string can contain a lone surrogate. The public instance path retains its literal
  // code unit; forming an internal URI fragment must not throw and turn a refusal into a 500.
  expect(await validate({ ['scope\uD800']: 'bad' })).toMatchObject({
    error: [
      {
        instancePath: '/scope\uD800',
        schemaPath: '#/scope%EF%BF%BD/invalid_type',
      },
    ],
  });
});

it('keeps response serialization failures separate from request validation', async () => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(requestValidatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  app.post(
    '/fixture',
    {
      schema: {
        body: z.strictObject({ count: z.number() }),
        response: { 200: z.strictObject({ count: z.number() }) },
      },
    },
    () => ({ count: 'wrong response type' }),
  );
  try {
    const response = await app.inject({ method: 'POST', url: '/fixture', payload: { count: 1 } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'RESPONSE_INVALID' });
    expect(response.body).not.toMatch(/stack|wrong response type/);
  } finally {
    await app.close();
  }
});
