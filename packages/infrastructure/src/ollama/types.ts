import type {
  ModelCatalogEntry,
  OllamaConnectionUpdate,
  OllamaConnectionView,
  OllamaDiscoveryStatus,
  OllamaModelDiscovery,
} from '@graphgoblin/contracts';
import type { HarnessPort } from '@graphgoblin/engine';

/** Complete persisted metadata; owner enablement remains independent of discovery. */
export type OllamaDiscoveredModel = OllamaModelDiscovery &
  Pick<ModelCatalogEntry, 'displayName' | 'efforts' | 'defaultEffort' | 'enabled'> & {
    /** Exact runtime/profile policy that qualified this digest; absent means unverified. */
    contextProfile?: string;
  };
export type OllamaDiscoveryError = NonNullable<OllamaDiscoveryStatus['error']>;
export interface OllamaRepository {
  read(defaults: OllamaConnectionUpdate): Promise<OllamaConnectionView>;
  configure(input: OllamaConnectionUpdate, at: string): Promise<OllamaConnectionView>;
  cached(revision: number): Promise<OllamaDiscoveredModel[]>;
  markRefreshing(revision: number, at: string): Promise<boolean>;
  reconcile(revision: number, at: string, models: OllamaDiscoveredModel[]): Promise<boolean>;
  fail(revision: number, at: string, error: OllamaDiscoveryError): Promise<void>;
}
export interface OllamaServices {
  harness: HarnessPort;
  view(): Promise<OllamaConnectionView>;
  configure(input: OllamaConnectionUpdate): Promise<OllamaConnectionView>;
  refresh(): Promise<OllamaDiscoveryStatus>;
  start(): void;
  stop(): Promise<void>;
}

export const OLLAMA_OFF_REASON = 'Ollama is off in Settings';
export const OLLAMA_UNLISTED_REASON = 'Not yet listed at the new address';
