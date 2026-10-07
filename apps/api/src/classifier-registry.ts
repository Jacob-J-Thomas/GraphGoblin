import { createJevDecider, DEFAULT_BASE_URL, DEFAULT_MODEL } from '@graphgoblin/adapter-jev';
import type { ClassifierModelEntry, ClassifierModelSummary } from '@graphgoblin/contracts';
import type {
  ClassifierPort,
  ClassifierRegistryPort,
  ClassifierResolution,
  Logger,
  SecretsPort,
} from '@graphgoblin/engine';
import { HttpChoiceClassifier } from '@graphgoblin/infrastructure/http';
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

type Configuration =
  | { configured: true; secret?: string }
  | {
      configured: false;
      reason: 'CLASSIFIER_SECRET_MISSING' | 'CLASSIFIER_SECRET_UNREADABLE';
      message: string;
    };

/** Composed here, where both the optional SDK and infrastructure HTTP transport are allowed. */
export class ClassifierRegistry implements ClassifierRegistryPort {
  private readonly clients = new Map<
    string,
    {
      ownerId: string;
      entry: ClassifierModelEntry;
      signature: string;
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
    entry: ClassifierModelEntry,
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
    this.clients.delete(JSON.stringify([ownerId, id]));
  }
  secretChanged(ownerId: string, name: string): void {
    for (const [key, client] of this.clients) {
      if (client.ownerId === ownerId && client.entry.secretRef === name) this.clients.delete(key);
    }
  }

  async resolve(ownerId: string, modelId: string): Promise<ClassifierResolution> {
    const entry = await this.repo.findOne(ownerId, modelId);
    if (!entry)
      return {
        status: 'unavailable',
        reason: 'CLASSIFIER_MODEL_NOT_FOUND',
        message: `Classifier '${modelId}' not found`,
      };
    if (!entry.primitives.includes('choice'))
      return {
        status: 'unavailable',
        reason: 'CLASSIFIER_PRIMITIVE_UNSUPPORTED',
        message: `Classifier '${modelId}' does not support Choice`,
      };
    if (!entry.enabled)
      return {
        status: 'unavailable',
        reason: 'CLASSIFIER_MODEL_DISABLED',
        message: `Classifier '${modelId}' is disabled`,
      };
    const state = await this.configuration(ownerId, entry);
    if (!state.configured)
      return {
        status: 'unavailable',
        reason: state.reason,
        message: `Classifier '${modelId}': ${state.message}`,
      };
    const key = JSON.stringify([ownerId, modelId]);
    const signature = JSON.stringify(entry);
    const cached = this.clients.get(key);
    if (cached?.signature === signature && cached.secret === state.secret)
      return {
        status: 'ready',
        classifier: cached.classifier,
        provenance: {
          provider: entry.provider,
          classifierId: entry.id,
          model: entry.providerModel,
        },
      };
    let classifier: ClassifierPort;
    if (entry.provider === 'typesafe') {
      // The adapter resolves this immutable snapshot rather than sharing the mutable exit client.
      const jev = createJevDecider({
        secrets: { resolve: () => Promise.resolve(state.secret) },
        ...(entry.secretRef !== undefined ? { secretName: entry.secretRef } : {}),
        baseUrl: entry.endpoint,
        model: entry.providerModel,
        logger: this.logger,
      });
      await jev.init();
      classifier = jev;
    } else {
      classifier = new HttpChoiceClassifier({
        endpoint: entry.endpoint,
        providerModel: entry.providerModel,
        ...(state.secret !== undefined ? { bearer: state.secret } : {}),
      });
    }
    this.clients.set(key, {
      ownerId,
      entry,
      signature,
      classifier,
      ...(state.secret !== undefined ? { secret: state.secret } : {}),
    });
    return {
      status: 'ready',
      classifier,
      provenance: { provider: entry.provider, classifierId: entry.id, model: entry.providerModel },
    };
  }
}
