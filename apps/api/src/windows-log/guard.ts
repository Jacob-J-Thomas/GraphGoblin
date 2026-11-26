import {
  GATEWAY_LOG_ACTIVE,
  GATEWAY_LOG_PREVIOUS,
  nodeLogFileSystem,
} from '../managed-log/gateway-log-writer.js';
import {
  LogDestinationRefusedError,
  takeLauncherVariable,
  type ManagedLogAdmission,
} from '../managed-log/guard.js';
import {
  LAUNCHER_LOG_DIR_VARIABLE,
  LogRootRefusedError,
  inspectLogRoot,
  reserveLogRoot,
  resolveLogRoot,
} from './managed-root.js';

export function takeLauncherLogDirectory(env: NodeJS.ProcessEnv): string | undefined {
  return takeLauncherVariable(env, LAUNCHER_LOG_DIR_VARIABLE);
}

export interface WindowsLogOperations {
  resolveRoot: typeof resolveLogRoot;
  reserve: typeof reserveLogRoot;
  inspect(root: string, names: readonly string[]): Promise<unknown>;
}

export const windowsLogOperations: WindowsLogOperations = {
  resolveRoot: resolveLogRoot,
  reserve: reserveLogRoot,
  inspect: inspectLogRoot,
};

/** Keep the Windows pipe reserved through ACL checks, slot admission and the gateway's lifetime. */
export async function admitWindowsLog(
  requested: string,
  operations: WindowsLogOperations = windowsLogOperations,
): Promise<ManagedLogAdmission> {
  let reservation: Awaited<ReturnType<typeof reserveLogRoot>> | undefined;
  try {
    const root = await operations.resolveRoot(requested);
    const held = await operations.reserve(root.pipeName);
    reservation = held;
    await operations.inspect(root.path, [GATEWAY_LOG_ACTIVE, GATEWAY_LOG_PREVIOUS]);
    return {
      root: root.path,
      fs: nodeLogFileSystem,
      releaseOnAdmissionFailure: () => held.release(),
    };
  } catch (error) {
    await reservation?.release().catch(() => undefined);
    throw new LogDestinationRefusedError(
      error instanceof LogRootRefusedError && error.reason === 'in-use' ? 'in-use' : 'unavailable',
    );
  }
}
