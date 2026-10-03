/**
 * @graphgoblin/plugin-codex
 *
 * The GraphGoblin Codex plugin lives in `plugin/graphgoblin` (manifest, `.mcp.json`, skills). This
 * module validates it and assembles an installable local marketplace with the MCP server's
 * absolute path filled in. See README.md and docs/07-api-and-streaming.md.
 */
export {
  assemblePlugin,
  loadPlugin,
  MARKETPLACE_NAME,
  MCP_ENTRY_PLACEHOLDER,
  type AssembledPlugin,
  type AssembleOptions,
  type LoadedPlugin,
} from './assemble.js';
export { defaultPaths, isEntryPoint, run } from './cli.js';
export {
  FrontmatterError,
  MarketplaceSchema,
  McpConfigSchema,
  McpServerEntrySchema,
  parseFrontmatter,
  parseSkill,
  PluginManifestSchema,
  SkillFrontmatterSchema,
  type Marketplace,
  type McpConfig,
  type PluginManifest,
  type SkillFrontmatter,
} from './manifest.js';
