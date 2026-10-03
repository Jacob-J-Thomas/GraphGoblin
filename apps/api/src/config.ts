import { resolve } from 'node:path';
import { EffortSchema } from '@graphgoblin/contracts';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  GG_HOST: z.string().default('127.0.0.1'),
  GG_PORT: z.coerce.number().int().min(0).max(65535).default(4747),
  GG_DATA_DIR: z.string().default('./data'),
  GG_DB_URL: z.string().optional(),
  GG_REQUIRE_API_KEY: bool.default(false),
  GG_MASTER_KEY: z.string().optional(),
  GG_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  GG_MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(64).default(4),
  GG_DEFAULT_MODEL: z.string().default('gpt-6-luna'),
  GG_DEFAULT_EFFORT: EffortSchema.default('low'),
  GG_TIMER_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
  GG_HOOK_RATE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(60),
  GG_SWAGGER_UI: bool.default(true),
  GG_PUBLIC_URL: z.string().optional(),
});

export interface ApiConfig {
  host: string;
  port: number;
  dataDir: string;
  dbUrl: string;
  requireApiKey: boolean;
  masterKey?: string;
  logLevel: z.infer<typeof EnvSchema>['GG_LOG_LEVEL'];
  maxConcurrentRuns: number;
  defaultModel: string;
  defaultEffort: z.infer<typeof EffortSchema>;
  timerPollMs: number;
  /** Webhook deliveries accepted per endpoint per minute. */
  hookRateLimitPerMinute: number;
  swaggerUi: boolean;
  publicUrl?: string;
}

/** Parse configuration from an environment map. Throws with a readable message on bad values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  const dataDir = resolve(e.GG_DATA_DIR);
  return {
    host: e.GG_HOST,
    port: e.GG_PORT,
    dataDir,
    dbUrl: e.GG_DB_URL ?? `file:${resolve(dataDir, 'graphgoblin.db').replace(/\\/g, '/')}`,
    requireApiKey: e.GG_REQUIRE_API_KEY,
    ...(e.GG_MASTER_KEY ? { masterKey: e.GG_MASTER_KEY } : {}),
    logLevel: e.GG_LOG_LEVEL,
    maxConcurrentRuns: e.GG_MAX_CONCURRENT_RUNS,
    defaultModel: e.GG_DEFAULT_MODEL,
    defaultEffort: e.GG_DEFAULT_EFFORT,
    timerPollMs: e.GG_TIMER_POLL_MS,
    hookRateLimitPerMinute: e.GG_HOOK_RATE_LIMIT,
    swaggerUi: e.GG_SWAGGER_UI,
    ...(e.GG_PUBLIC_URL ? { publicUrl: e.GG_PUBLIC_URL } : {}),
  };
}
