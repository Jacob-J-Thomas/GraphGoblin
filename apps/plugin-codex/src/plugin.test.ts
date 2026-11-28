import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
  mkdir,
  cp,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { runCli } from './cli.js';
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

/** Every entry below `dir` with its text, to show a refusal left an output exactly as it was. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    tree[relative(dir, path).split(sep).join('/')] = entry.isFile()
      ? await readFile(path, 'utf8')
      : 'folder';
  }
  return tree;
}

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
    scratch = await mkdtemp(join(await realpath(tmpdir()), 'gg-plugin-'));
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

      // A repeat can refresh generated files, but preserves foreign contents.
      const newEntry = join(testDir, 'next entry 漢.js');
      await assemblePlugin({ pluginDir, outDir, mcpEntry: newEntry });
      const rebuilt = await loadPlugin(join(outDir, 'plugins', 'graphgoblin'));
      expect(rebuilt.mcp.mcpServers['graphgoblin']?.args).toEqual([newEntry]);

      const sentinel = join(outDir, 'foreign.txt');
      await writeFile(sentinel, 'keep');
      await expect(assemblePlugin({ pluginDir, outDir, mcpEntry })).rejects.toThrow(
        /foreign.txt.*not owned/,
      );
      expect(await readFile(sentinel, 'utf8')).toBe('keep');
    },
    fileIoTimeout,
  );

  it(
    'refuses unsupported source entries before changing the marketplace',
    async () => {
      const copy = join(scratch, 'source 漢', 'plugin', 'graphgoblin');
      await cp(pluginDir, copy, { recursive: true });
      const outDir = join(scratch, 'marketplace');
      const mcpEntry = join(scratch, 'main.js');
      await assemblePlugin({ pluginDir: copy, outDir, mcpEntry });
      const before = await snapshot(outDir);
      const assemble = () => assemblePlugin({ pluginDir: copy, outDir, mcpEntry });

      const skill = join(copy, 'skills', 'run-loop');
      await mkdir(join(skill, 'scripts'));
      await writeFile(join(skill, 'scripts', 'collect.ps1'), 'Write-Output 1');
      await writeFile(join(skill, 'reference.md'), 'supporting reference');
      await expect(assemble()).rejects.toThrow(
        `Unsupported plugin source entries in "${copy}": "skills/run-loop/reference.md", "skills/run-loop/scripts/". This builder packages only ".codex-plugin/plugin.json", ".mcp.json", "skills/`,
      );
      await rm(join(skill, 'scripts'), { recursive: true });
      await rm(join(skill, 'reference.md'));

      // Neither a stray file nor a linked folder in the skills folder is skipped or followed.
      const elsewhere = join(scratch, 'elsewhere skill');
      await mkdir(elsewhere);
      await writeFile(join(elsewhere, 'SKILL.md'), await readFile(join(skill, 'SKILL.md')));
      await writeFile(join(copy, 'skills', 'notes.txt'), 'not a skill');
      await symlink(
        elsewhere,
        join(copy, 'skills', 'linked-skill'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(assemble()).rejects.toThrow(
        `: "skills/linked-skill" (link, not followed), "skills/notes.txt". This builder packages only`,
      );
      expect(await snapshot(outDir)).toEqual(before);
      expect(await readdir(scratch)).not.toContain('.marketplace.graphgoblin-build');
    },
    fileIoTimeout,
  );

  /** A copy of the plugin source assembled once, with a snapshot of that marketplace. */
  async function assembledCopy() {
    const copy = join(scratch, 'source 漢', 'plugin', 'graphgoblin');
    await cp(pluginDir, copy, { recursive: true });
    const outDir = join(scratch, 'marketplace');
    const mcpEntry = join(scratch, 'main.js');
    await assemblePlugin({ pluginDir: copy, outDir, mcpEntry });
    const assemble = () => assemblePlugin({ pluginDir: copy, outDir, mcpEntry });
    return { copy, outDir, before: await snapshot(outDir), assemble };
  }

  it(
    'refuses a folder without SKILL.md in the skills folder, naming it, before reading skills',
    async () => {
      const { copy, outDir, before, assemble } = await assembledCopy();
      await mkdir(join(copy, 'skills', 'references'));
      await writeFile(join(copy, 'skills', 'references', 'note.md'), 'supporting reference');
      await mkdir(join(copy, 'skills', 'empty'));
      await expect(assemble()).rejects.toThrow(
        `Unsupported plugin source entries in "${copy}": "skills/empty/", "skills/references/". This builder packages only ".codex-plugin/plugin.json", ".mcp.json", "skills/`,
      );
      expect(await snapshot(outDir)).toEqual(before);
      expect(await readdir(scratch)).not.toContain('.marketplace.graphgoblin-build');
    },
    fileIoTimeout,
  );

  it(
    'refuses a link at an entry it reads before following or reading it',
    async () => {
      const { copy, outDir, before, assemble } = await assembledCopy();
      // A junction needs no Windows symlink privilege but can only target a folder, which reading
      // through it fails on. Elsewhere the link targets text that the loader would reject if it
      // read it. Either way only a refusal made before the read produces the expected message.
      const linkType = process.platform === 'win32' ? 'junction' : 'file';
      const elsewhere = join(scratch, 'elsewhere');
      await mkdir(join(elsewhere, 'run-loop'), { recursive: true });
      await writeFile(join(elsewhere, 'run-loop', 'SKILL.md'), 'not a skill');
      const unread = join(scratch, 'unread.txt');
      await writeFile(unread, 'not a plugin file');
      const target = process.platform === 'win32' ? elsewhere : unread;
      const missing = join(scratch, 'missing');
      const link = (entry: string) =>
        `: "${entry}" (link, not followed). This builder packages only`;
      const manifest = `Unsupported plugin source entry "${join(copy, '.codex-plugin', 'plugin.json')}": the plugin manifest must be a regular file, and links are not followed`;
      const cases = [
        ['.mcp.json', target, link('.mcp.json')],
        ['.mcp.json', missing, link('.mcp.json')],
        ['skills/run-loop/SKILL.md', target, link('skills/run-loop/SKILL.md')],
        ['skills/run-loop/SKILL.md', missing, link('skills/run-loop/SKILL.md')],
        ['skills', elsewhere, link('skills')],
        ['.codex-plugin/plugin.json', target, manifest],
        ['.codex-plugin/plugin.json', missing, manifest],
      ] as const;
      const aside = join(scratch, 'aside');
      for (const [entry, linked, refusal] of cases) {
        const path = join(copy, ...entry.split('/'));
        await rename(path, aside);
        await symlink(linked, path, linkType);
        await expect(assemble(), `${entry} linked to ${linked}`).rejects.toThrow(refusal);
        await rm(path);
        await rename(aside, path);
      }
      expect(await snapshot(outDir)).toEqual(before);
      expect(await readFile(unread, 'utf8')).toBe('not a plugin file');
    },
    fileIoTimeout,
  );

  // Node cannot create a FIFO itself; POSIX hosts (CI) use mkfifo, Windows has no FIFO files.
  it.skipIf(process.platform === 'win32')(
    'refuses a FIFO at an entry it reads without opening it',
    async () => {
      const { copy, outDir, before, assemble } = await assembledCopy();
      const cases = [
        ['.mcp.json', ': ".mcp.json". This builder packages only'],
        ['skills/run-loop/SKILL.md', ': "skills/run-loop/SKILL.md". This builder packages only'],
        [
          '.codex-plugin/plugin.json',
          `Unsupported plugin source entry "${join(copy, '.codex-plugin', 'plugin.json')}": the plugin manifest must be a regular file`,
        ],
      ] as const;
      const aside = join(scratch, 'aside');
      for (const [entry, refusal] of cases) {
        const path = join(copy, ...entry.split('/'));
        await rename(path, aside);
        expect(spawnSync('mkfifo', [path]).status).toBe(0);
        // Opening a FIFO that has no writer blocks, so a read would hang instead of refusing.
        await expect(assemble(), entry).rejects.toThrow(refusal);
        await rm(path);
        await rename(aside, path);
      }
      expect(await snapshot(outDir)).toEqual(before);
    },
    fileIoTimeout,
  );

  it(
    'names a changed generated inventory and keeps the earlier marketplace',
    async () => {
      const copy = join(scratch, 'source', 'plugin', 'graphgoblin');
      await cp(pluginDir, copy, { recursive: true });
      const outDir = join(scratch, 'marketplace');
      const mcpEntry = join(scratch, 'main.js');
      await assemblePlugin({ pluginDir: copy, outDir, mcpEntry });
      const before = await snapshot(outDir);

      // A new valid skill is a supported input, so it changes the generated inventory.
      await mkdir(join(copy, 'skills', 'review-loop'));
      await writeFile(
        join(copy, 'skills', 'review-loop', 'SKILL.md'),
        '---\nname: review-loop\ndescription: Review a GraphGoblin loop draft before publishing it.\n---\n\n# Review\n',
      );
      await expect(assemblePlugin({ pluginDir: copy, outDir, mcpEntry })).rejects.toThrow(
        `Unsafe plugin output destination "${outDir}": its ownership marker from this builder lists a different file inventory from the one this version generates (generated now but not listed: "plugins/graphgoblin/skills/review-loop/SKILL.md"). The builder verifies and replaces only its current inventory and never removes entries named only by a marker. Inspect this directory and move it aside, or choose an unused destination`,
      );
      expect(await snapshot(outDir)).toEqual(before);

      const fresh = join(scratch, 'fresh marketplace');
      const assembled = await assemblePlugin({ pluginDir: copy, outDir: fresh, mcpEntry });
      expect(assembled.skills.map((skill) => skill.name).sort()).toEqual([
        'design-loop',
        'inspect-run',
        'review-loop',
        'run-loop',
      ]);
      expect((await loadPlugin(join(fresh, 'plugins', 'graphgoblin'))).skills).toHaveLength(4);
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
        await runCli(['--out', out, '--mcp-entry', entry], fakePackage, (l) => lines.push(l)),
      ).toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(resolve(out));
      const sentinel = join(out, 'unrelated.txt');
      await writeFile(sentinel, 'preserve');
      expect(
        await runCli(['--out', out, '--mcp-entry', entry], fakePackage, (line) => lines.push(line)),
      ).toBe(1);
      expect(lines.at(-1)).toMatch(/Unsafe plugin output destination.*unrelated.txt.*not owned/);
      expect(await readFile(sentinel, 'utf8')).toBe('preserve');

      // A missing generated folder is named instead of surfacing a raw ENOENT.
      await rm(sentinel);
      await rm(join(out, 'plugins', 'graphgoblin', 'skills'), { recursive: true });
      expect(
        await runCli(['--out', out, '--mcp-entry', entry], fakePackage, (line) => lines.push(line)),
      ).toBe(1);
      expect(lines.at(-1)).toBe(
        `Unsafe plugin output destination "${resolve(out)}": expected generated entries are missing: "plugins/graphgoblin/skills". Choose an unused destination, or inspect this directory and move it aside before rebuilding`,
      );
    },
    fileIoTimeout,
  );

  it('recognises its own entry point', () => {
    const cli = pathToFileURL(join(packageDir, 'src', 'cli.ts')).href;
    expect(isEntryPoint(fileURLToPath(cli), cli)).toBe(true);
    expect(isEntryPoint(undefined, cli)).toBe(false);
  });
});
