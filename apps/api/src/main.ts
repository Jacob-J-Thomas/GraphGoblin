// Gateway process entry. The static imports use only Node built-ins. A launcher-managed
// gateway imports the application only after admitting its private log destination.
import { isPhysicalEntry } from './entry-point.js';
import type { ServeResult } from './serve.js';
import { productionDependencies, runManagedGateway } from './managed-log/guard.js';
import { admitWindowsLog, takeLauncherLogDirectory } from './windows-log/guard.js';
import { admitMacosLog, takeMacosLogAdmission } from './macos-log/guard.js';

/** Bounded Windows log protocol. The launcher and installer require this exact declaration. */
export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;
/** Bounded Mac log protocol. The launcher checks the exact declaration in the built entry. */
export const MACOS_LAUNCHER_LOG_PROTOCOL = 1;

/** Process entry point: configure, migrate, recover runs, listen, and shut down cleanly. */
export async function main(): Promise<ServeResult> {
  const { serve } = await import('./serve.js');
  return serve();
}

/** In precedence order: the first one present is dispatched. */
const COMMANDS = ['--preflight', '--create-api-key', '--reset'] as const;

if (isPhysicalEntry(process.argv[1], import.meta.url)) {
  // Consumed under every spelling, in every mode, before any application or provider code loads.
  const windowsLogDirectory = takeLauncherLogDirectory(process.env);
  const macosLogAdmission = takeMacosLogAdmission(process.env);
  const command = COMMANDS.find((flag) => process.argv.includes(flag));
  const admit =
    windowsLogDirectory !== undefined && process.platform === 'win32'
      ? () => admitWindowsLog(windowsLogDirectory)
      : macosLogAdmission !== undefined && process.platform === 'darwin'
        ? () => admitMacosLog(macosLogAdmission)
        : undefined;
  if (command === undefined && admit !== undefined) {
    void runManagedGateway(
      admit,
      productionDependencies(() => import('./serve.js')),
      process.platform === 'darwin' ? 'macos' : undefined,
    ).then((code) => {
      if (code !== undefined) process.exit(code);
    });
  } else {
    // `--preflight` prints the first-run checks, `--create-api-key` mints a key and `--reset`
    // lists (or, confirmed, removes) the store; each exits without starting the server (docs/11).
    const run =
      command === '--preflight'
        ? import('./preflight.js')
            .then(({ runPreflightCli }) => runPreflightCli())
            .then((code) => process.exit(code))
        : command === '--create-api-key'
          ? import('./create-api-key.js')
              .then(({ runCreateApiKeyCli }) => runCreateApiKeyCli())
              .then((code) => process.exit(code))
          : command === '--reset'
            ? import('./reset/reset.js')
                .then(({ runResetCli }) => runResetCli())
                .then((code) => process.exit(code))
            : main();
    run.catch(async (error: unknown) => {
      // A store or GG_DEFAULTS refusal prints its complete explanation instead of a stack.
      const output = await import('./serve.js').then(
        ({ shellFailureOutput }) => shellFailureOutput(error),
        () => error,
      );
      console.error(output);
      process.exit(1);
    });
  }
}
