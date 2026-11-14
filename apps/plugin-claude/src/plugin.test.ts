import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEntryPoint, run } from './cli.js';
import { adaptSkill, assembleClaudePlugin, defaultPaths } from './index.js';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

describe('Claude plugin artifact', () => {
  let scratch: string;
  let entry: string;
  let outDir: string;
  beforeEach(async () => {
    scratch = await mkdtemp(join(await realpath(tmpdir()), 'gg claude 漢 '));
    entry = join(scratch, 'mcp test fixture.js');
    outDir = join(scratch, 'output');
    await writeFile(entry, '');
  });
  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('writes native configuration, shared workflows and no credential values', async () => {
    await expect(assembleClaudePlugin(packageDir, { outDir, mcpEntry: entry })).resolves.toBe(
      outDir,
    );
    const manifest = JSON.parse(
      await readFile(join(outDir, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({ name: 'graphgoblin', version: '0.1.0', license: 'MIT' });
    expect(manifest).not.toHaveProperty('interface');
    const mcpFile = await readFile(join(outDir, '.mcp.json'), 'utf8');
    expect(JSON.parse(mcpFile)).toEqual({
      mcpServers: {
        graphgoblin: {
          type: 'stdio',
          command: '${GG_NODE_BINARY:-node}',
          args: [
            '--require',
            '${CLAUDE_PLUGIN_ROOT}/check-runtime.cjs',
            entry.split(sep).join('/'),
            '--draft-tools',
          ],
        },
      },
    });
    expect(mcpFile).not.toContain('GG_API_KEY');
    const readSkill = (name: string) => readFile(join(outDir, 'skills', name, 'SKILL.md'), 'utf8');
    const design = await readSkill('design-loop');
    expect(design).toContain('disable-model-invocation: true');
    expect(design).toContain('validate_loop_definition');
    expect(design).toContain('save_loop_draft');
    expect(design).toContain('Webhook and Event triggers reject');
    expect(design).not.toMatch(/Invoke-RestMethod|\/loops\/.*publish|never publishes unless/i);
    const example = design.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? '';
    expect(LoopDefinitionSchema.safeParse(JSON.parse(example)).success).toBe(true);
    const run = await readSkill('run-loop');
    expect(run).toMatch(
      /disable-model-invocation: true[\s\S]+Only start a run when the user explicitly requests one/,
    );
    expect(run).toContain('/graphgoblin:inspect-run');
    expect(run).toContain('explicitly requested the draft or confirmed draft execution');
    const inspect = await readSkill('inspect-run');
    expect(inspect).toContain('plugin:graphgoblin:graphgoblin');
    expect(inspect).toContain('read_run_events');
    expect(inspect).not.toContain('disable-model-invocation');
    expect(await readFile(join(outDir, 'check-runtime.cjs'), 'utf8')).toContain('GG_NODE_BINARY');
  });

  it('rebuilds into an owned output and refuses an extra file', async () => {
    await assembleClaudePlugin(packageDir, { outDir, mcpEntry: entry });
    const moved = join(scratch, 'moved entry.js');
    await writeFile(moved, '');
    await assembleClaudePlugin(packageDir, { outDir, mcpEntry: moved });
    const mcp = await readFile(join(outDir, '.mcp.json'), 'utf8');
    expect(mcp).toContain(moved.split(sep).join('/'));
    const sentinel = join(outDir, 'foreign.txt');
    await writeFile(sentinel, 'keep');
    await expect(assembleClaudePlugin(packageDir, { outDir, mcpEntry: moved })).rejects.toThrow(
      /foreign.txt.*not owned/,
    );
    expect(await readFile(sentinel, 'utf8')).toBe('keep');
  });

  it('gives a rebuild instruction for a missing or non-file MCP entry', async () => {
    await mkdir(outDir);
    for (const mcpEntry of [join(scratch, 'missing.js'), outDir]) {
      await expect(assembleClaudePlugin(packageDir, { outDir, mcpEntry })).rejects.toThrow(
        /MCP entry is missing.*Run pnpm build/,
      );
    }
    expect(defaultPaths(packageDir).outDir).toBe(join(packageDir, 'dist', 'plugin', 'graphgoblin'));
  });

  it('refuses assembly when the shared design skill no longer has its draft boundary', () => {
    expect(() => adaptSkill('design-loop', '---\r\nchanged source\r\n', '')).toThrow(
      /has no shared draft section/,
    );
    expect(() => adaptSkill('run-loop', '# No frontmatter\n', '')).toThrow(/has no frontmatter/);
  });

  it('accepts CLI overrides and rejects unknown flags', async () => {
    const cli = join(packageDir, 'src', 'cli.ts');
    expect(isEntryPoint(cli, pathToFileURL(cli).href)).toBe(true);
    expect(isEntryPoint(undefined, pathToFileURL(cli).href)).toBe(false);
    const lines: string[] = [];
    expect(
      await run(['--out', outDir, '--mcp-entry', entry], packageDir, (line) => lines.push(line)),
    ).toBe(0);
    expect(lines.join('\n')).toContain(`claude --plugin-dir "${outDir}"`);
    expect(await run(['--unrecognized'], packageDir, (line) => lines.push(line))).toBe(1);
    expect(lines.at(-1)).toMatch(/Unknown option/);
  });

  it('resolves the default package layout independent of the calling directory', async () => {
    const fakeApps = join(scratch, 'apps');
    const fakePackage = join(fakeApps, 'plugin-claude');
    const paths = defaultPaths(fakePackage);
    const source = defaultPaths(packageDir);
    await mkdir(fakePackage, { recursive: true });
    await cp(source.pluginDir, paths.pluginDir, { recursive: true });
    await cp(join(packageDir, 'README.md'), join(fakePackage, 'README.md'));
    await cp(source.sharedSkills, paths.sharedSkills, { recursive: true });
    await mkdir(join(fakeApps, 'mcp', 'dist'), { recursive: true });
    await writeFile(paths.mcpEntry, '');
    expect(await run([], fakePackage, () => {})).toBe(0);
    expect(await readFile(join(paths.outDir, '.mcp.json'), 'utf8')).toContain(
      paths.mcpEntry.split(sep).join('/'),
    );
  });
});
