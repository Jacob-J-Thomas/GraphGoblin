/**
 * Schemas for the Codex plugin files, as verified against Codex CLI 0.160.0 and the plugins
 * installed on the development machine (docs/research/codex-sdk.md):
 *
 * - `<plugin>/.codex-plugin/plugin.json`: the manifest. `skills` and `mcpServers` are paths
 *   relative to the plugin root.
 * - `<plugin>/.mcp.json`: `{ "mcpServers": { <name>: <server> } }`, the same server table as
 *   `[mcp_servers.<name>]` in `config.toml` (`command`, `args`, `cwd`, `env`, `env_vars`, timeouts).
 * - `<plugin>/skills/<name>/SKILL.md`: Markdown with `name` and `description` frontmatter.
 * - `<marketplace>/.agents/plugins/marketplace.json`: lists plugins with a local `source.path`.
 */
import { z } from 'zod';

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

export const PluginManifestSchema = z.looseObject({
  name: Slug,
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  description: z.string().min(1),
  author: z.looseObject({ name: z.string().min(1) }),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  skills: z.string().startsWith('./'),
  mcpServers: z.string().startsWith('./'),
  interface: z.looseObject({
    displayName: z.string().min(1),
    shortDescription: z.string().min(1),
    longDescription: z.string().optional(),
    developerName: z.string().optional(),
    category: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    defaultPrompt: z.array(z.string()).optional(),
  }),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const McpServerEntrySchema = z.looseObject({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  env_vars: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  startup_timeout_sec: z.number().positive().optional(),
  tool_timeout_sec: z.number().positive().optional(),
});

export const McpConfigSchema = z.strictObject({
  mcpServers: z.record(Slug, McpServerEntrySchema),
});
export type McpConfig = z.infer<typeof McpConfigSchema>;

export const MarketplaceSchema = z.looseObject({
  name: Slug,
  interface: z.looseObject({ displayName: z.string().min(1) }).optional(),
  plugins: z
    .array(
      z.looseObject({
        name: Slug,
        source: z.strictObject({ source: z.literal('local'), path: z.string().startsWith('./') }),
        policy: z.looseObject({ installation: z.string(), authentication: z.string() }).optional(),
        category: z.string().optional(),
      }),
    )
    .min(1),
});
export type Marketplace = z.infer<typeof MarketplaceSchema>;

export const SkillFrontmatterSchema = z.looseObject({
  name: Slug,
  description: z.string().min(20).max(1024),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** Thrown when a SKILL.md has no frontmatter block or a line that is not `key: value`. */
export class FrontmatterError extends Error {
  override readonly name = 'FrontmatterError';
}

/**
 * Parse the YAML frontmatter of a SKILL.md. Skills use flat `key: value` lines only, so this
 * accepts that subset (optionally quoted values) and rejects anything else.
 */
export function parseFrontmatter(markdown: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
  if (!match) throw new FrontmatterError('SKILL.md must start with a --- frontmatter block');
  const data: Record<string, string> = {};
  for (const line of (match[1] as string).split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) throw new FrontmatterError(`unsupported frontmatter line: ${line}`);
    const raw = (pair[2] as string).trim();
    data[pair[1] as string] = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return { data, body: match[2] as string };
}

/** Parse and validate a SKILL.md. */
export function parseSkill(markdown: string): SkillFrontmatter & { body: string } {
  const { data, body } = parseFrontmatter(markdown);
  return { ...SkillFrontmatterSchema.parse(data), body };
}
