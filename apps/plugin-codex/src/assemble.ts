import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
  /** Where to write the local marketplace; replaced if it exists. */
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
  await rm(marketplaceDir, { recursive: true, force: true });
  await mkdir(join(marketplaceDir, '.agents', 'plugins'), { recursive: true });
  await cp(options.pluginDir, installedPluginDir, { recursive: true });

  const mcp: McpConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(source.mcp.mcpServers).map(([key, server]) => [
        key,
        {
          ...server,
          args: server.args.map((arg) =>
            arg.replace(MCP_ENTRY_PLACEHOLDER, resolve(options.mcpEntry)),
          ),
        },
      ]),
    ),
  };
  await writeFile(
    resolve(installedPluginDir, source.manifest.mcpServers),
    `${JSON.stringify(mcp, null, 2)}\n`,
  );

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
  await writeFile(
    join(marketplaceDir, '.agents', 'plugins', 'marketplace.json'),
    `${JSON.stringify(marketplace, null, 2)}\n`,
  );
  return { ...source, mcp, marketplace, marketplaceDir, installedPluginDir };
}
