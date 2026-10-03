import type { Effort, HarnessOptions } from '@graphgoblin/contracts';
import type { CodexOptions, ModelReasoningEffort, ThreadOptions } from '@openai/codex-sdk';

/**
 * Building the SDK's client and thread options. Every behaviour-affecting setting is passed
 * explicitly so the machine's `~/.codex/config.toml` defaults never leak into a loop.
 *
 * Verified against `@openai/codex-sdk` 0.160.0 (`dist/index.js`, `CodexExec.run`): the per-thread
 * options are turned into these CLI arguments, which come after any `config` overrides and so win
 * over both them and `config.toml`:
 *
 * | ThreadOptions          | CLI argument                                       |
 * | ---------------------- | -------------------------------------------------- |
 * | `model`                | `--model <id>`                                     |
 * | `modelReasoningEffort` | `--config model_reasoning_effort="<level>"`        |
 * | `sandboxMode`          | `--sandbox read-only|workspace-write|danger-full-access` |
 * | `approvalPolicy`       | `--config approval_policy="never|on-request|on-failure|untrusted"` |
 * | `networkAccessEnabled` | `--config sandbox_workspace_write.network_access=<bool>` |
 * | `webSearchMode`        | `--config web_search="disabled|cached|live"`       |
 * | `workingDirectory`     | `--cd <dir>`                                       |
 * | `skipGitRepoCheck`     | `--skip-git-repo-check`                            |
 */

/** The canonical effort scale onto Codex's. Codex tops out at `xhigh`, so `max` maps there. */
export function mapEffort(effort: Effort): ModelReasoningEffort {
  return effort === 'max' ? 'xhigh' : effort;
}

export interface ResolvedSettings {
  model: string;
  effort: Effort;
  options: HarnessOptions;
  workingDirectory?: string;
}

export function threadOptions(settings: ResolvedSettings): ThreadOptions {
  const { options } = settings;
  return {
    model: settings.model,
    modelReasoningEffort: mapEffort(settings.effort),
    sandboxMode: options.sandbox,
    approvalPolicy: options.approval,
    networkAccessEnabled: options.networkAccess ?? false,
    webSearchMode: options.webSearch ? 'live' : 'disabled',
    skipGitRepoCheck: true,
    ...(settings.workingDirectory ? { workingDirectory: settings.workingDirectory } : {}),
  };
}

type ConfigValue = NonNullable<CodexOptions['config']>[string];

/**
 * Keep only values the SDK can serialise to TOML (strings, finite numbers, booleans, arrays and
 * objects of those). `null`, `undefined`, and anything else are dropped rather than letting the SDK
 * throw at spawn time.
 */
export function sanitizeConfig(value: unknown): ConfigValue | undefined {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.map(sanitizeConfig).filter((v): v is ConfigValue => v !== undefined);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, ConfigValue> = {};
    for (const [key, child] of Object.entries(value)) {
      const clean = sanitizeConfig(child);
      if (key && clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return undefined;
}

/**
 * Client options: `harnessOptions.configOverrides` become the SDK's `config` (dotted `--config`
 * keys). The explicit thread options above are emitted after them, so overrides cannot weaken the
 * sandbox, approval, model, or effort a node declared.
 */
export function clientOptions(
  options: HarnessOptions,
  codexBinary: string | undefined,
  env: Record<string, string> | undefined,
): CodexOptions {
  const config = sanitizeConfig(options.configOverrides ?? {}) as NonNullable<
    CodexOptions['config']
  >;
  return {
    ...(codexBinary ? { codexPathOverride: codexBinary } : {}),
    ...(env ? { env } : {}),
    ...(Object.keys(config).length ? { config } : {}),
  };
}
