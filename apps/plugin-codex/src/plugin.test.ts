import { mkdtemp, readFile, rm, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import {
  assemblePlugin,
  defaultPaths,
  FrontmatterError,
  isEntryPoint,
  loadPlugin,
  MARKETPLACE_NAME,
  MCP_ENTRY_PLACEHOLDER,
  McpConfigSchema,
  MarketplaceSchema,
  parseFrontmatter,
  parseSkill,
  run,
} from './index.js';

const packageDir = resolve(fileURLToPath(import.meta.url), '..', '..');
const { pluginDir } = defaultPaths(packageDir);
const SKILLS = ['design-loop', 'inspect-run', 'run-loop'];
const MCP_TOOLS = [
  'list_loops',
  'describe_loop',
  'start_run',
  'wait_for_run',
  'get_run',
  'get_run_thread',
  'list_runs',
  'read_run_events',
  'cancel_run',
  'pause_run',
  'resume_run',
  'provide_input',
  'send_signal',
];

describe('plugin source', () => {
  it('has a valid manifest, MCP config, and the three skills', async () => {
    const plugin = await loadPlugin(pluginDir);
    expect(plugin.manifest).toMatchObject({
      name: 'graphgoblin',
      skills: './skills/',
      mcpServers: './.mcp.json',
    });
    expect(plugin.skills.map((s) => s.name).sort()).toEqual(SKILLS);
    const server = plugin.mcp.mcpServers['graphgoblin'];
    expect(server).toMatchObject({
      command: 'node',
      args: [MCP_ENTRY_PLACEHOLDER],
      env_vars: ['GG_API_URL', 'GG_API_KEY'],
    });
    expect(server?.tool_timeout_sec).toBeGreaterThan(600);
  });

  it('only names MCP tools that the server provides', async () => {
    for (const name of SKILLS) {
      const { body } = parseSkill(
        await readFile(join(pluginDir, 'skills', name, 'SKILL.md'), 'utf8'),
      );
      const mentioned = [...body.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
      for (const tool of mentioned) {
        if (tool === 'env_vars') continue;
        expect(MCP_TOOLS, `${name} mentions ${tool}`).toContain(tool);
      }
    }
  });

  it('ships a design-loop example definition that the contracts accept', async () => {
    const markdown = await readFile(join(pluginDir, 'skills', 'design-loop', 'SKILL.md'), 'utf8');
    const example = /```json\n([\s\S]*?)\n```/.exec(markdown)?.[1];
    expect(LoopDefinitionSchema.safeParse(JSON.parse(example as string)).success).toBe(true);
    for (const kind of [
      'trigger',
      'decision',
      'inference',
      'script',
      'mutate',
      'subloop',
      'wait',
      'heartbeat',
      'exit',
    ]) {
      expect(markdown).toContain(`| \`${kind}\``);
    }
  });
});

describe('frontmatter', () => {
  it('parses flat key: value pairs and quoted values', () => {
    expect(parseFrontmatter('---\nname: x\n\ndescription: "a: b"\n---\nbody')).toEqual({
      data: { name: 'x', description: 'a: b' },
      body: 'body',
    });
    expect(parseFrontmatter("---\r\nname: 'y'\r\n---\r\n").data).toEqual({ name: 'y' });
  });

  it('rejects missing or nested frontmatter and invalid skills', () => {
    expect(() => parseFrontmatter('# no frontmatter')).toThrow(FrontmatterError);
    expect(() => parseFrontmatter('---\nname: x\n  nested: y\n---\n')).toThrow(
      /unsupported frontmatter line/,
    );
    expect(() => parseSkill('---\nname: Bad Name\ndescription: short\n---\n')).toThrow();
  });
});

describe('assemble', () => {
  // Directory copies can exceed Vitest's 5 s default when all packages run in parallel.
  const fileIoTimeout = 20_000;
  let scratch: string;
  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'gg-plugin-'));
  });
  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it(
    'builds an installable marketplace with the absolute MCP entry',
    async () => {
      const testDir = scratch;
      const outDir = join(testDir, 'marketplace');
      const mcpEntry = join(testDir, 'mcp', 'main.js');
      await mkdir(join(testDir, 'mcp'));
      await writeFile(mcpEntry, '');
      const assembled = await assemblePlugin({ pluginDir, outDir, mcpEntry });
      expect(assembled.marketplaceDir).toBe(resolve(outDir));

      const marketplace = MarketplaceSchema.parse(
        JSON.parse(await readFile(join(outDir, '.agents', 'plugins', 'marketplace.json'), 'utf8')),
      );
      expect(marketplace.name).toBe(MARKETPLACE_NAME);
      expect(marketplace.plugins[0]?.source).toEqual({
        source: 'local',
        path: './plugins/graphgoblin',
      });

      const installed = await loadPlugin(join(outDir, 'plugins', 'graphgoblin'));
      expect(installed.mcp.mcpServers['graphgoblin']?.args).toEqual([resolve(mcpEntry)]);
      expect(installed.skills).toHaveLength(3);
      const written = McpConfigSchema.parse(
        JSON.parse(await readFile(join(outDir, 'plugins', 'graphgoblin', '.mcp.json'), 'utf8')),
      );
      expect(written).toEqual(assembled.mcp);

      // Assembling again replaces the previous output.
      await writeFile(join(outDir, 'stale.txt'), 'x');
      await assemblePlugin({ pluginDir, outDir, mcpEntry });
      await expect(readFile(join(outDir, 'stale.txt'), 'utf8')).rejects.toThrow();
    },
    fileIoTimeout,
  );

  it(
    'rejects a skill whose folder and name disagree',
    async () => {
      const testDir = scratch;
      const copy = join(testDir, 'broken');
      await cp(pluginDir, copy, { recursive: true });
      await mkdir(join(copy, 'skills', 'renamed'));
      await writeFile(
        join(copy, 'skills', 'renamed', 'SKILL.md'),
        '---\nname: other-name\ndescription: A skill whose folder does not match.\n---\n',
      );
      await writeFile(join(copy, 'skills', 'README.txt'), 'not a skill');
      await expect(loadPlugin(copy)).rejects.toThrow(/declares name "other-name"/);
    },
    fileIoTimeout,
  );

  it(
    'runs from the CLI entry with defaults and overrides',
    async () => {
      const testDir = scratch;
      const lines: string[] = [];
      const fakePackage = join(testDir, 'pkg', 'plugin-codex');
      await cp(pluginDir, join(fakePackage, 'plugin', 'graphgoblin'), { recursive: true });
      expect(await run([], fakePackage, (line) => lines.push(line))).toBe(0);
      expect(lines[0]).toMatch(/does not exist yet/);
      expect(lines[1]).toContain(`codex plugin add graphgoblin@${MARKETPLACE_NAME}`);

      const entry = join(testDir, 'entry.js');
      await writeFile(entry, '');
      const out = join(testDir, 'cli-out');
      lines.length = 0;
      expect(
        await run(['--out', out, '--mcp-entry', entry], fakePackage, (l) => lines.push(l)),
      ).toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(resolve(out));
    },
    fileIoTimeout,
  );

  it('recognises its own entry point', () => {
    const cli = pathToFileURL(join(packageDir, 'src', 'cli.ts')).href;
    expect(isEntryPoint(fileURLToPath(cli), cli)).toBe(true);
    expect(isEntryPoint(undefined, cli)).toBe(false);
  });
});
