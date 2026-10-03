import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assemblePlugin, MARKETPLACE_NAME } from './assemble.js';

/** Paths relative to this package: `<pkg>/plugin/graphgoblin`, `<pkg>/dist/marketplace`, `apps/mcp/dist/main.js`. */
export function defaultPaths(packageDir: string) {
  return {
    pluginDir: resolve(packageDir, 'plugin', 'graphgoblin'),
    outDir: resolve(packageDir, 'dist', 'marketplace'),
    mcpEntry: resolve(packageDir, '..', 'mcp', 'dist', 'main.js'),
  };
}

/** `node dist/cli.js [--out <dir>] [--mcp-entry <path>]`: assemble the installable marketplace. */
export async function run(
  argv: readonly string[],
  packageDir: string,
  log: (line: string) => void,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { out: { type: 'string' }, 'mcp-entry': { type: 'string' } },
  });
  const defaults = defaultPaths(packageDir);
  const mcpEntry = resolve(values['mcp-entry'] ?? defaults.mcpEntry);
  const assembled = await assemblePlugin({
    pluginDir: defaults.pluginDir,
    outDir: values.out ?? defaults.outDir,
    mcpEntry,
  });
  if (!existsSync(mcpEntry)) {
    log(`warning: ${mcpEntry} does not exist yet; run pnpm build so the MCP server is built`);
  }
  log(
    [
      `Assembled ${assembled.manifest.name}@${MARKETPLACE_NAME} with skills ${assembled.skills.map((s) => s.name).join(', ')}.`,
      `Install: codex plugin marketplace add "${assembled.marketplaceDir}"`,
      `         codex plugin add ${assembled.manifest.name}@${MARKETPLACE_NAME}`,
    ].join('\n'),
  );
  return 0;
}

/** True when `entry` (normally `process.argv[1]`) is the module at `moduleUrl`. */
export function isEntryPoint(entry: string | undefined, moduleUrl: string): boolean {
  try {
    return realpathSync(entry ?? '') === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await run(process.argv.slice(2), packageDir, console.error);
}
