// QA module-resolution hooks (independent QA for #506/#511). Loads the worktree's TypeScript source
// directly (development condition, .js -> .ts), and swaps node:fs/promises and node:child_process
// for observing wrappers only when the importer is a cli.ts (the HEAD source or a scratch copy of an
// older revision). The wrappers call the real functions unchanged.
const WT = 'file:///G:/ggq/gg-fu-codex-cleanup-20261124/GraphGoblin/';
const ADAPTER_CLI = WT + 'packages/adapter-codex/src/cli.ts';
const SPY_FS = new URL('./fs-spy.mjs', import.meta.url).href;
const SPY_CP = new URL('./cp-spy.mjs', import.meta.url).href;
const isCli = (parent) => typeof parent === 'string' && /\/cli\.ts$/.test(parent);

export async function resolve(specifier, context, next) {
  if (isCli(context.parentURL)) {
    if (specifier === 'node:fs/promises') return { url: SPY_FS, shortCircuit: true };
    if (specifier === 'node:child_process') return { url: SPY_CP, shortCircuit: true };
  }
  if (specifier.startsWith('@graphgoblin/')) {
    const parentURL =
      context.parentURL && context.parentURL.startsWith(WT) ? context.parentURL : ADAPTER_CLI;
    return next(specifier, {
      ...context,
      parentURL,
      conditions: [...context.conditions, 'development'],
    });
  }
  try {
    return await next(specifier, context);
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' &&
      /^\.\.?\//.test(specifier) &&
      specifier.endsWith('.js')
    )
      return next(specifier.slice(0, -3) + '.ts', context);
    throw error;
  }
}
