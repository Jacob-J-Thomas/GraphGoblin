import { createJevDecider, DEFAULT_BASE_URL, DEFAULT_MODEL } from '@graphgoblin/adapter-jev';
import type {
  ClassifierBinding,
  ClassifierModelEntry,
  ClassifierModelSummary,
  ClassifierPrimitive,
} from '@graphgoblin/contracts';
import type {
  ClassifierPort,
  ClassifierRegistryPort,
  ClassifierResolution,
  Logger,
  SecretsPort,
} from '@graphgoblin/engine';
import { HttpClassifier } from '@graphgoblin/infrastructure/http';
import type { SqliteClassifierModels } from '@graphgoblin/infrastructure/sqlite';

export const BUILTIN_CLASSIFIER: ClassifierModelEntry = {
  id: 'jev',
  displayName: 'Jev',
  source: 'builtin',
  provider: 'typesafe',
  providerModel: DEFAULT_MODEL,
  primitives: ['choice', 'noul', 'score'],
  endpoint: DEFAULT_BASE_URL,
  secretRef: 'jev-api-key',
  enabled: true,
};

/** The part of a catalog entry a run pins: what it calls, not whether it may call it now. */
export function bindingOf(entry: ClassifierModelEntry): ClassifierBinding {
  return {
    provider: entry.provider,
    providerModel: entry.providerModel,
    primitives: [...entry.primitives],
    endpoint: entry.endpoint,
    ...(entry.secretRef !== undefined ? { secretRef: entry.secretRef } : {}),
  };
}

type Configuration =
  | { configured: true; secret?: string }
  | {
      configured: false;
      reason: 'CLASSIFIER_SECRET_MISSING' | 'CLASSIFIER_SECRET_UNREADABLE';
      message: string;
    };

/** Composed here, where both the optional SDK and infrastructure HTTP transport are allowed. */
export class ClassifierRegistry implements ClassifierRegistryPort {
  /** Clients per owner, catalog id and pinned binding, rebuilt when the secret value changes. */
  private readonly clients = new Map<
    string,
    {
      ownerId: string;
      modelId: string;
      binding: ClassifierBinding;
      secret?: string;
      classifier: ClassifierPort;
    }
  >();

  constructor(
    private readonly repo: Pick<SqliteClassifierModels, 'findOne' | 'list'>,
    private readonly secretsFor: (ownerId: string) => SecretsPort,
    private readonly logger: Logger,
  ) {}

  private async configuration(
    ownerId: string,
    entry: Pick<ClassifierModelEntry, 'secretRef'>,
  ): Promise<Configuration> {
    if (!entry.secretRef) return { configured: true };
    try {
      const secret = (await this.secretsFor(ownerId).resolve(entry.secretRef))?.trim();
      return secret
        ? { configured: true, secret }
        : {
            configured: false,
            reason: 'CLASSIFIER_SECRET_MISSING',
            message: `Missing or blank secret '${entry.secretRef}'. Set it in Settings, Secrets.`,
          };
    } catch {
      return {
        configured: false,
        reason: 'CLASSIFIER_SECRET_UNREADABLE',
        message: `Unreadable secret '${entry.secretRef}'. Set it in Settings, Secrets.`,
      };
    }
  }

  async inspect(
    ownerId: string,
    entry: ClassifierModelEntry,
  ): Promise<{
    summary: ClassifierModelSummary;
    issue?: 'CLASSIFIER_SECRET_MISSING' | 'CLASSIFIER_SECRET_UNREADABLE';
  }> {
    const state = await this.configuration(ownerId, entry);
    return {
      summary: {
        ...entry,
        configured: state.configured,
        ...(!state.configured ? { configurationReason: state.message } : {}),
      },
      ...(!state.configured ? { issue: state.reason } : {}),
    };
  }

  async summarize(ownerId: string, entry: ClassifierModelEntry): Promise<ClassifierModelSummary> {
    return (await this.inspect(ownerId, entry)).summary;
  }

  async list(ownerId: string): Promise<ClassifierModelSummary[]> {
    return Promise.all(
      (await this.repo.list(ownerId)).map((entry) => this.summarize(ownerId, entry)),
    );
  }

  invalidate(ownerId: string, id: string): void {
    for (const [key, client] of this.clients) {
      if (client.ownerId === ownerId && client.modelId === id) this.clients.delete(key);
    }
  }
  secretChanged(ownerId: string, name: string): void {
    for (const [key, client] of this.clients) {
      if (client.ownerId === ownerId && client.binding.secretRef === name) this.clients.delete(key);
    }
  }

  async bind(ownerId: string, modelId: string): Promise<ClassifierBinding | undefined> {
    const entry = await this.repo.findOne(ownerId, modelId);
    return entry ? bindingOf(entry) : undefined;
  }

  /**
   * A client for a run's pinned binding (ADR-0041). The entry must still exist and be enabled, and
   * the pinned secret name must resolve now; provider, model, endpoint and primitives are the
   * pinned ones, so editing the entry reaches only runs started afterwards.
   */
  async resolve(
    ownerId: string,
    modelId: string,
    primitive: ClassifierPrimitive,
    binding: ClassifierBinding,
  ): Promise<ClassifierResolution> {
    const entry = await this.repo.findOne(ownerId, modelId);
    if (!entry)
      return {
        status: 'unavailable',
        reason: 'CLASSIFIER_MODEL_NOT_FOUND',
        message: `Classifier '${modelId}' not found`,
      };
    if (!binding.primitives.includes(primitive))
      return {
        status: 'unavailable',
        reason: 'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
        message: `Classifier '${modelId}' does not support ${primitive}`,
      };
    if (!entry.enabled)
      return {
        status: 'unavailable',
        reason: 'CLASSIFIER_MODEL_DISABLED',
        message: `Classifier '${modelId}' is disabled`,
      };
    const state = await this.configuration(ownerId, binding);
    if (!state.configured)
      return {
        status: 'unavailable',
        reason: state.reason,
        message: `Classifier '${modelId}': ${state.message}`,
      };
    const provenance = {
      provider: binding.provider,
      classifierId: modelId,
      model: binding.providerModel,
    };
    const key = JSON.stringify([ownerId, modelId, binding]);
    const cached = this.clients.get(key);
    if (cached && cached.secret === state.secret)
      return { status: 'ready', classifier: cached.classifier, provenance };
    let classifier: ClassifierPort;
    if (binding.provider === 'typesafe') {
      // Each cached classifier uses an immutable owner-scoped credential snapshot.
      const jev = createJevDecider({
        secrets: { resolve: () => Promise.resolve(state.secret) },
        ...(binding.secretRef !== undefined ? { secretName: binding.secretRef } : {}),
        baseUrl: binding.endpoint,
        model: binding.providerModel,
        logger: this.logger,
      });
      await jev.init();
      classifier = jev;
    } else {
      classifier = new HttpClassifier({
        endpoint: binding.endpoint,
        providerModel: binding.providerModel,
        ...(state.secret !== undefined ? { bearer: state.secret } : {}),
      });
    }
    this.clients.set(key, {
      ownerId,
      modelId,
      binding,
      classifier,
      ...(state.secret !== undefined ? { secret: state.secret } : {}),
    });
    return { status: 'ready', classifier, provenance };
  }
}
