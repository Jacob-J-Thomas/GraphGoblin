import {
  OllamaConnectionUpdateSchema,
  OllamaConnectionViewSchema,
  OllamaDiscoveryStatusSchema,
} from '@graphgoblin/contracts';
import { z } from 'zod';
import type { Container } from '../container.js';
import type { ApiInstance } from '../types.js';

/** Gateway connection lifecycle; discovery never generates or downloads a model. */
export function registerOllamaRoutes(
  app: ApiInstance,
  container: { ollama: Pick<Container['ollama'], 'view' | 'configure' | 'refresh'> },
): void {
  app.get(
    '/harness/ollama/connection',
    {
      schema: {
        tags: ['settings'],
        summary: 'The gateway Ollama connection and its last discovery result',
        description: 'Requires settings:read. The connection belongs to the gateway.',
        response: { 200: OllamaConnectionViewSchema },
      },
    },
    () => container.ollama.view(),
  );

  app.put(
    '/harness/ollama/connection',
    {
      schema: {
        tags: ['settings'],
        summary: 'Save the gateway Ollama connection and discover its models',
        description:
          'Requires gateway-owner wildcard authority. A discovery failure still returns the saved connection with discovery.state:error. Accepts an HTTP(S) origin without credentials, query, fragment, or API path.',
        body: OllamaConnectionUpdateSchema,
        response: { 200: OllamaConnectionViewSchema },
      },
    },
    (request) => container.ollama.configure(request.body),
  );

  app.post(
    '/model-catalog/refresh',
    {
      schema: {
        tags: ['settings'],
        summary: 'Refresh the models discovered from the configured Ollama service',
        description:
          'Requires settings:write. Coalesces with an active Ollama refresh. Does not generate, download, or select a model, or change enabled preferences.',
        body: z.strictObject({ harness: z.literal('ollama') }),
        response: { 200: OllamaDiscoveryStatusSchema },
      },
    },
    () => container.ollama.refresh(),
  );
}
