import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assembleClaudePlugin } from './index.js';

export async function run(
  argv: readonly string[],
  packageDir: string,
  log: (line: string) => void,
) {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { out: { type: 'string' }, 'mcp-entry': { type: 'string' } },
    });
    const output = await assembleClaudePlugin(packageDir, {
      outDir: values.out,
      mcpEntry: values['mcp-entry'],
    });
    log(`Assembled GraphGoblin for Claude Code. Load with claude --plugin-dir "${output}"`);
    return 0;
  } catch (error) {
    log(String(error));
    return 1;
  }
}

export function isEntryPoint(entry: string | undefined, moduleUrl: string): boolean {
  try {
    return realpathSync(entry ?? '') === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.exitCode = await run(
    process.argv.slice(2),
    fileURLToPath(new URL('..', import.meta.url)),
    console.error,
  );
}
