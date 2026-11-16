import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether `entry` (normally `process.argv[1]`) is the physical module at `moduleUrl`, including
 * when Node was started through a checkout alias such as a junction or symlink. Built-ins only.
 */
export function isPhysicalEntry(entry: string | undefined, moduleUrl: string): boolean {
  if (!entry) return false;
  try {
    return realpathSync.native(entry) === realpathSync.native(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
