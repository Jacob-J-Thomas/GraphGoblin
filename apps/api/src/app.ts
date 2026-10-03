import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyServerOptions } from 'fastify';
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Container } from './container.js';
import { openApiRegistry } from './openapi-registry.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler } from './plugins/errors.js';
import { registerStatic } from './plugins/static.js';
import { registerLoopRoutes } from './routes/loops.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSystemRoutes } from './routes/system.js';
import { API_VERSION, type ApiInstance } from './types.js';

export interface BuildAppOptions {
  /** Fastify logger option; a pino instance for production, `false` in tests. */
  logger?: FastifyServerOptions['logger'] | FastifyBaseLogger;
}

export async function buildApp(
  container: Container,
  options: BuildAppOptions = {},
): Promise<ApiInstance> {
  const loggerOption = options.logger;
  const base = Fastify({
    ...(loggerOption === undefined ||
    typeof loggerOption === 'boolean' ||
    (typeof loggerOption === 'object' && !('child' in loggerOption))
      ? { logger: loggerOption ?? false }
      : { loggerInstance: loggerOption }),
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: false,
  });
  base.setValidatorCompiler(validatorCompiler);
  base.setSerializerCompiler(serializerCompiler);
  const app = base.withTypeProvider<ZodTypeProvider>();

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'GraphGoblin API',
        version: API_VERSION,
        description:
          'Design, run, and observe agent loops. Commands are REST; run state is a snapshot plus an event stream.',
      },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'loops', description: 'Loop definitions, drafts, versions' },
        { name: 'runs', description: 'Starting, observing, and controlling runs' },
        { name: 'settings', description: 'Owner settings and the model catalog' },
        { name: 'secrets', description: 'Named secrets (values are never returned)' },
        { name: 'api-keys', description: 'Keys for other applications and the MCP server' },
        { name: 'events', description: 'The inbound event bus' },
        { name: 'system', description: 'Health, version, harness preflight' },
      ],
    },
    transform: createJsonSchemaTransform({ schemaRegistry: openApiRegistry }),
    transformObject: createJsonSchemaTransformObject({ schemaRegistry: openApiRegistry }),
  });
  if (container.config.swaggerUi) {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());

  registerErrorHandler(app);
  registerAuth(app, container);
  registerSystemRoutes(app, container);
  registerLoopRoutes(app, container);
  registerRunRoutes(app, container);
  registerSettingsRoutes(app, container);
  await registerStatic(app, container.config.webDist);

  return app;
}
