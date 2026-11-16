/**
 * Guarded managed entry for a gateway started by the Windows desktop launcher (#438, ADR-0081).
 * Node built-ins only. Before any dependency-bearing module loads, this consumes the reserved
 * launcher variable, reserves the private physical log root, admits the two fixed gateway log
 * slots and only then imports the application with the bounded private Pino destination.
 *
 * Exits before readiness are internal launcher outcomes: 70 destination in use, 71 destination
 * unsafe or unavailable, 72/73 application import failed with/without a written diagnostic,
 * 74/75 application startup failed with/without a written diagnostic.
 */
import {
  GATEWAY_LOG_ACTIVE,
  GATEWAY_LOG_EXIT_FLUSH_MS,
  GATEWAY_LOG_PREVIOUS,
  openGatewayLog,
  type GatewayLogWriter,
  type GatewayLogWriterOptions,
} from './gateway-log-writer.js';
import {
  LAUNCHER_LOG_DIR_VARIABLE,
  LogRootRefusedError,
  inspectLogRoot,
  reserveLogRoot,
  resolveLogRoot,
  type AdmittedLogRoot,
  type LogRootReservation,
} from './managed-root.js';

export const ManagedExit = {
  destinationInUse: 70,
  destinationUnavailable: 71,
  importFailedWritten: 72,
  importFailedUnwritten: 73,
  startupFailedWritten: 74,
  startupFailedUnwritten: 75,
} as const;

/** Reached startup stages. The application reports each before it begins that work. */
export type StartupStage = 'configuration' | 'store' | 'recovery' | 'http' | 'bind';

/** Closed cause codes. Each has fixed operator text; raw errors never enter the record. */
export const STARTUP_CAUSES = {
  'module-not-found': 'A built application module or dependency is missing.',
  'native-module-failed': 'A native module could not be loaded by this Node runtime.',
  'module-load-failed': 'The application modules could not be loaded.',
  'invalid-configuration': 'The gateway configuration or GG_* overrides are invalid.',
  'store-held': 'Another GraphGoblin process holds this store.',
  'store-ownership-unverified': 'Store ownership could not be verified.',
  'store-refused': 'The store uses an unsupported format.',
  'defaults-refused': 'The configured GG_DEFAULTS were refused.',
  'process-identity-unavailable': 'The Windows process identity could not be established.',
  'store-unavailable': 'The store could not be opened.',
  'recovery-failed': 'Run recovery failed during startup.',
  'http-setup-failed': 'The HTTP server could not be prepared.',
  'port-in-use': 'The configured port is already in use.',
  'port-denied': 'The configured port could not be bound.',
  'bind-failed': 'The gateway could not start listening.',
  unexpected: 'An unexpected startup error occurred.',
} as const;
export type StartupCause = keyof typeof STARTUP_CAUSES;

const GUIDANCE: Record<StartupStage | 'import', string> = {
  import: 'Rebuild the checkout with Node 22 (pnpm install, then pnpm build) and launch again.',
  configuration: 'Correct the launcher configuration and its GG_* overrides, then launch again.',
  store: 'Check the configured store and any other GraphGoblin process, then launch again.',
  recovery: 'Run the gateway from a terminal to see the recovery error, then launch again.',
  http: 'Run the gateway from a terminal to see the server error, then launch again.',
  bind: 'Free the configured port or choose another, then launch again.',
};

/** The closed startup-failure record. Contains no exception, path, config or environment value. */
export function startupFailureRecord(
  stage: StartupStage | 'import',
  cause: StartupCause,
  time: number,
  pid: number,
): string {
  return (
    JSON.stringify({
      level: 50,
      time,
      pid,
      msg:
        stage === 'import' ? 'GraphGoblin application import failed' : 'GraphGoblin startup failed',
      stage,
      cause,
      detail: STARTUP_CAUSES[cause],
      guidance: GUIDANCE[stage],
    }) + '\n'
  );
}

/** Import failures are classified by Node's closed error codes only. */
export function importFailureCause(error: unknown): StartupCause {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') return 'module-not-found';
  if (code === 'ERR_DLOPEN_FAILED') return 'native-module-failed';
  return 'module-load-failed';
}

/**
 * Remove the reserved launcher variable under every spelling, so neither configuration nor any
 * provider process inherits it. Returns its value.
 */
export function takeLauncherLogDirectory(env: NodeJS.ProcessEnv): string | undefined {
  let value: string | undefined;
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() !== LAUNCHER_LOG_DIR_VARIABLE) continue;
    value ??= env[name];
    delete env[name];
  }
  return value;
}

/** What the dynamically imported application supplies to the guard. */
export interface ManagedApplication {
  serve(options: {
    managed: {
      destination: { write(chunk: string): boolean };
      onStage(stage: StartupStage): void;
      beforeExit(): Promise<unknown>;
    };
  }): Promise<unknown>;
  startupFailureCause(stage: StartupStage, error: unknown): StartupCause;
}

export interface ManagedGatewayDependencies {
  resolveRoot(requested: string): Promise<AdmittedLogRoot>;
  reserve(pipeName: string): Promise<LogRootReservation>;
  inspect(root: string, names: readonly string[]): Promise<unknown>;
  openLog(options: GatewayLogWriterOptions): Promise<GatewayLogWriter>;
  loadApplication(): Promise<ManagedApplication>;
  now(): number;
  delay(ms: number): Promise<void>;
}

/** Ref'd on purpose: the bounded acknowledgment wait must elapse before an exit decision. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const productionDependencies = (
  loadApplication: () => Promise<ManagedApplication>,
): ManagedGatewayDependencies => ({
  resolveRoot: (requested) => resolveLogRoot(requested),
  reserve: (pipeName) => reserveLogRoot(pipeName),
  inspect: (root, names) => inspectLogRoot(root, names),
  openLog: (options) => openGatewayLog(options),
  loadApplication,
  now: Date.now,
  delay,
});

/** Write one closed record and wait at most 250 ms for that exact record to complete. */
async function acknowledged(
  writer: GatewayLogWriter,
  record: string,
  deps: ManagedGatewayDependencies,
): Promise<boolean> {
  return Promise.race([
    writer.writeAcknowledged(record),
    deps.delay(GATEWAY_LOG_EXIT_FLUSH_MS).then(() => false),
  ]);
}

/**
 * Admit the managed destination and start the application. Resolves `undefined` once the gateway
 * is listening, or the internal exit code for a failure before readiness. Never throws.
 */
export async function runManagedGateway(
  requested: string,
  deps: ManagedGatewayDependencies,
): Promise<number | undefined> {
  let reservation: LogRootReservation | undefined;
  let writer: GatewayLogWriter;
  try {
    const root = await deps.resolveRoot(requested);
    reservation = await deps.reserve(root.pipeName);
    // Metadata and slot admission happen only while the reservation is held.
    await deps.inspect(root.path, [GATEWAY_LOG_ACTIVE, GATEWAY_LOG_PREVIOUS]);
    writer = await deps.openLog({ root: root.path });
  } catch (error) {
    await reservation?.release().catch(() => undefined);
    return error instanceof LogRootRefusedError && error.reason === 'in-use'
      ? ManagedExit.destinationInUse
      : ManagedExit.destinationUnavailable;
  }

  let application: ManagedApplication;
  try {
    application = await deps.loadApplication();
  } catch (error) {
    const record = startupFailureRecord(
      'import',
      importFailureCause(error),
      deps.now(),
      process.pid,
    );
    return (await acknowledged(writer, record, deps))
      ? ManagedExit.importFailedWritten
      : ManagedExit.importFailedUnwritten;
  }

  let stage: StartupStage = 'configuration';
  try {
    await application.serve({
      managed: {
        destination: writer,
        onStage: (reached) => {
          stage = reached;
        },
        beforeExit: () => writer.settle(GATEWAY_LOG_EXIT_FLUSH_MS),
      },
    });
    // The reservation stays held for the gateway's lifetime; the OS releases it on exit.
    return undefined;
  } catch (error) {
    let cause: StartupCause;
    try {
      cause = application.startupFailureCause(stage, error);
    } catch {
      cause = 'unexpected';
    }
    const record = startupFailureRecord(stage, cause, deps.now(), process.pid);
    return (await acknowledged(writer, record, deps))
      ? ManagedExit.startupFailedWritten
      : ManagedExit.startupFailedUnwritten;
  }
}
