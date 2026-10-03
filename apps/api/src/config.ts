import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EffortSchema } from '@graphgoblin/contracts';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  GG_HOST: z.string().default('127.0.0.1'),
  GG_PORT: z.coerce.number().int().min(0).max(65535).default(4747),
  GG_DATA_DIR: z.string().optional(),
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
  GG_CODEX_BINARY: z.string().optional(),
  /**
   * Directory of the built web app (apps/web/dist), served at /app/. Unset: the checkout's
   * `apps/web/dist` when it has been built (see `bundledWebDist`). Empty: no web app.
   */
  GG_WEB_DIST: z.string().optional(),
  GG_JEV_API_KEY: z.string().optional(),
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
  /** Path to a `codex` executable. Default: the CLI bundled with `@openai/codex-sdk`. */
  codexBinary?: string;
  /** Absolute path of the built web app to serve under /app/, if configured. */
  webDist?: string;
  /** Seeds the local owner's Jev secret at startup only when it is absent. */
  jevApiKey?: string;
}

/** The default data directory: `~/.graphgoblin`. */
export function defaultDataDir(): string {
  return join(homedir(), '.graphgoblin');
}

/**
 * The web app built next to this package in a checkout (`apps/web/dist`, found relative to this
 * module in both `src` and `dist`), when its `index.html` exists. `main` uses it as the default
 * for `GG_WEB_DIST`, so `pnpm start` serves the UI with no configuration.
 */
export function bundledWebDist(exists: (path: string) => boolean = existsSync): string | undefined {
  const dir = fileURLToPath(new URL('../../web/dist', import.meta.url));
  return exists(join(dir, 'index.html')) ? dir : undefined;
}

export interface LoadConfigOptions {
  /** The web app directory to serve when `GG_WEB_DIST` is unset. */
  webDistFallback?: string | undefined;
}

/** Parse configuration from an environment map. Throws with a readable message on bad values. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  const dataDir = resolve(e.GG_DATA_DIR || defaultDataDir());
  const webDist = e.GG_WEB_DIST ?? options.webDistFallback;
  const jevApiKey = e.GG_JEV_API_KEY ?? env.JEV_API_KEY;
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
    ...(e.GG_CODEX_BINARY ? { codexBinary: e.GG_CODEX_BINARY } : {}),
    ...(webDist ? { webDist: resolve(webDist) } : {}),
    ...(jevApiKey ? { jevApiKey } : {}),
  };
}
