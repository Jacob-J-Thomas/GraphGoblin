import { readdir, readFile } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
import { writePluginOutput } from '@graphgoblin/tooling/plugin-output';
import {
  MarketplaceSchema,
  McpConfigSchema,
  parseSkill,
  PluginManifestSchema,
  type Marketplace,
  type McpConfig,
  type PluginManifest,
  type SkillFrontmatter,
} from './manifest.js';

/** Stands in for the absolute path of `apps/mcp/dist/main.js` in the source `.mcp.json`. */
export const MCP_ENTRY_PLACEHOLDER = '${GRAPHGOBLIN_MCP_ENTRY}';
export const MARKETPLACE_NAME = 'graphgoblin-local';

export interface LoadedPlugin {
  manifest: PluginManifest;
  mcp: McpConfig;
  skills: SkillFrontmatter[];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

/** Read and validate a plugin directory: manifest, MCP config, and every skill. */
export async function loadPlugin(pluginDir: string): Promise<LoadedPlugin> {
  const manifest = PluginManifestSchema.parse(
    await readJson(join(pluginDir, '.codex-plugin', 'plugin.json')),
  );
  const mcp = McpConfigSchema.parse(await readJson(resolve(pluginDir, manifest.mcpServers)));
  const skillsDir = resolve(pluginDir, manifest.skills);
  const skills: SkillFrontmatter[] = [];
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = parseSkill(await readFile(join(skillsDir, entry.name, 'SKILL.md'), 'utf8'));
    if (skill.name !== entry.name) {
      throw new Error(`skill folder "${entry.name}" declares name "${skill.name}"`);
    }
    skills.push({ name: skill.name, description: skill.description });
  }
  return { manifest, mcp, skills };
}

export interface AssembleOptions {
  /** The plugin source directory (`apps/plugin-codex/plugin/graphgoblin`). */
  pluginDir: string;
  /** Where to write the local marketplace; existing output must be empty or owned. */
  outDir: string;
  /** Absolute path of the built MCP server entry, `apps/mcp/dist/main.js`. */
  mcpEntry: string;
}

export interface AssembledPlugin extends LoadedPlugin {
  /** The marketplace root to pass to `codex plugin marketplace add`. */
  marketplaceDir: string;
  /** The installable plugin inside it. */
  installedPluginDir: string;
  marketplace: Marketplace;
}

/**
 * Codex copies an installed plugin into its cache (`~/.codex/plugins/cache/<marketplace>/...`), so
 * a path relative to this repository would break. Assembling copies the plugin into a local
 * marketplace and writes the absolute MCP server path into its `.mcp.json`.
 */
export async function assemblePlugin(options: AssembleOptions): Promise<AssembledPlugin> {
  const source = await loadPlugin(options.pluginDir);
  const name = source.manifest.name;
  const marketplaceDir = resolve(options.outDir);
  const installedPluginDir = join(marketplaceDir, 'plugins', name);

  const mcp: McpConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(source.mcp.mcpServers).map(([key, server]) => [
        key,
        {
          ...server,
          args: server.args.map((arg) =>
            arg.replace(MCP_ENTRY_PLACEHOLDER, () => resolve(options.mcpEntry)),
          ),
        },
      ]),
    ),
  };
  const marketplace = MarketplaceSchema.parse({
    name: MARKETPLACE_NAME,
    interface: { displayName: 'GraphGoblin (local build)' },
    plugins: [
      {
        name,
        source: { source: 'local', path: `./plugins/${name}` },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Developer Tools',
      },
    ],
  });
  const packageDir = resolve(options.pluginDir, '..', '..');
  const prefix = `plugins/${name}`;
  const skillFiles = await Promise.all(
    source.skills.map(async (skill) => {
      const file = posix.join(source.manifest.skills, skill.name, 'SKILL.md');
      return [`${prefix}/${file}`, await readFile(join(options.pluginDir, file))] as const;
    }),
  );
  await writePluginOutput({
    outDir: marketplaceDir,
    packageDir,
    defaultOutDir: resolve(packageDir, 'dist', 'marketplace'),
    protectedPaths: [options.pluginDir, options.mcpEntry],
    kind: 'codex-marketplace',
    files: {
      '.agents/plugins/marketplace.json': `${JSON.stringify(marketplace, null, 2)}\n`,
      [`${prefix}/.codex-plugin/plugin.json`]: await readFile(
        join(options.pluginDir, '.codex-plugin', 'plugin.json'),
      ),
      [`${prefix}/${source.manifest.mcpServers.slice(2)}`]: `${JSON.stringify(mcp, null, 2)}\n`,
      ...Object.fromEntries(skillFiles),
    },
  });
  return { ...source, mcp, marketplace, marketplaceDir, installedPluginDir };
}
