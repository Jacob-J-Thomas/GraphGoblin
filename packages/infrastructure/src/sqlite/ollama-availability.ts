import type { ModelCatalogAvailability } from '@graphgoblin/contracts';
import type { modelDiscovery, ollamaConnection } from './schema.js';

/** Connection state is authoritative without rewriting the last complete discovery snapshot. */
export function ollamaAvailability(
  connection: typeof ollamaConnection.$inferSelect | null | undefined,
  metadata: typeof modelDiscovery.$inferSelect | null | undefined,
): ModelCatalogAvailability {
  const checkedAt = metadata?.availability.checkedAt ?? new Date().toISOString();
  if (connection && !connection.enabled)
    return { state: 'missing', checkedAt, reason: 'Ollama is off in Settings' };
  if (!connection || !metadata || metadata.connectionRevision !== connection.revision)
    return { state: 'missing', checkedAt, reason: 'Not yet listed at the new address' };
  return metadata.availability;
}
