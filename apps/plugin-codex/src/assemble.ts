import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
import { checkSourceInventory, writePluginOutput } from '@graphgoblin/tooling/plugin-output';
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
const MANIFEST = '.codex-plugin/plugin.json';

export interface LoadedPlugin {
  manifest: PluginManifest;
  mcp: McpConfig;
  skills: SkillFrontmatter[];
}

/** The manifest and the folders of the skills it implies, found before any other file is read. */
interface LocatedPlugin {
  manifest: PluginManifest;
  skillFolders: string[];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

/**
 * What `name` below `root` is, from `lstat` alone so that nothing is followed or read. The name is
 * normalized as `resolve` would, and every folder on the way must be a real folder. A missing part
 * rejects with `ENOENT`.
 */
async function entryKind(root: string, name: string): Promise<'file' | 'folder' | 'other'> {
  const parts = posix
    .normalize(name)
    .split('/')
    .filter((part) => part !== '' && part !== '.');
  let path = root;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const stat = await lstat(path);
    if (!stat.isDirectory()) return stat.isFile() && index === parts.length - 1 ? 'file' : 'other';
  }
  return 'folder';
}

/**
 * Read the manifest, which must be a regular file, and find the skill folders it implies without
 * reading them: each folder in its skills folder that holds a `SKILL.md` entry. A skills folder
 * that is a link or a special file is not listed.
 */
async function locatePlugin(pluginDir: string): Promise<LocatedPlugin> {
  if ((await entryKind(pluginDir, MANIFEST)) !== 'file')
    throw new Error(
      `Unsupported plugin source entry "${join(pluginDir, MANIFEST)}": the plugin manifest must be a regular file, and links are not followed`,
    );
  const manifest = PluginManifestSchema.parse(await readJson(join(pluginDir, MANIFEST)));
  const skillsDir = resolve(pluginDir, manifest.skills);
  const skillFolders: string[] = [];
  if ((await entryKind(pluginDir, manifest.skills)) === 'folder')
    for (const entry of await readdir(skillsDir, { withFileTypes: true }))
      if (entry.isDirectory() && (await readdir(join(skillsDir, entry.name))).includes('SKILL.md'))
        skillFolders.push(entry.name);
  return { manifest, skillFolders };
}

/** Read and validate the MCP config and every located skill. */
async function readPlugin(pluginDir: string, located: LocatedPlugin): Promise<LoadedPlugin> {
  const { manifest, skillFolders } = located;
  const mcp = McpConfigSchema.parse(await readJson(resolve(pluginDir, manifest.mcpServers)));
  const skillsDir = resolve(pluginDir, manifest.skills);
  const skills: SkillFrontmatter[] = [];
  for (const folder of skillFolders) {
    const skill = parseSkill(await readFile(join(skillsDir, folder, 'SKILL.md'), 'utf8'));
    if (skill.name !== folder) {
      throw new Error(`skill folder "${folder}" declares name "${skill.name}"`);
    }
    skills.push({ name: skill.name, description: skill.description });
  }
  return { manifest, mcp, skills };
}

/** Read and validate a plugin directory: manifest, MCP config, and every skill. */
export async function loadPlugin(pluginDir: string): Promise<LoadedPlugin> {
  return readPlugin(pluginDir, await locatePlugin(pluginDir));
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
 * marketplace and writes the absolute MCP server path into its `.mcp.json`. It packages only the
 * manifest, the configured MCP file and each skill's `SKILL.md`, and refuses any other source entry.
 */
export async function assemblePlugin(options: AssembleOptions): Promise<AssembledPlugin> {
  const located = await locatePlugin(options.pluginDir);
  const mcpFile = located.manifest.mcpServers.slice(2);
  const skillNames = located.skillFolders.map((folder) =>
    posix.join(located.manifest.skills, folder, 'SKILL.md'),
  );
  // Package only the finite inputs located here. Refuse anything else, and any of these that is a
  // link or a special file, before reading them or touching the output.
  await checkSourceInventory(options.pluginDir, [MANIFEST, mcpFile, ...skillNames]);
  const source = await readPlugin(options.pluginDir, located);
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
    skillNames.map(
      async (file) => [`${prefix}/${file}`, await readFile(join(options.pluginDir, file))] as const,
    ),
  );
  await writePluginOutput({
    outDir: marketplaceDir,
    packageDir,
    defaultOutDir: resolve(packageDir, 'dist', 'marketplace'),
    protectedPaths: [options.pluginDir, options.mcpEntry],
    kind: 'codex-marketplace',
    files: {
      '.agents/plugins/marketplace.json': `${JSON.stringify(marketplace, null, 2)}\n`,
      [`${prefix}/${MANIFEST}`]: await readFile(join(options.pluginDir, MANIFEST)),
      [`${prefix}/${mcpFile}`]: `${JSON.stringify(mcp, null, 2)}\n`,
      ...Object.fromEntries(skillFiles),
    },
  });
  return { ...source, mcp, marketplace, marketplaceDir, installedPluginDir };
}
