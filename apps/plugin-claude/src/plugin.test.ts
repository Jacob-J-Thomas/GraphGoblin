import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEntryPoint, run } from './cli.js';
import { adaptSkill, assembleClaudePlugin, defaultPaths } from './index.js';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const skillNames = ['design-loop', 'inspect-run', 'run-loop'] as const;

/** Copy this package's inputs into a disposable layout that `defaultPaths` resolves. */
async function copyPackage(root: string) {
  const copy = join(root, 'apps', 'plugin-claude');
  const paths = defaultPaths(copy);
  const source = defaultPaths(packageDir);
  await mkdir(copy, { recursive: true });
  await cp(source.pluginDir, paths.pluginDir, { recursive: true });
  await cp(join(packageDir, 'README.md'), join(copy, 'README.md'));
  await cp(source.sharedSkills, paths.sharedSkills, { recursive: true });
  return { copy, paths };
}

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
    expect(run).toContain(
      '`allowDraft: true` permits execution only when the loop has no published version; it cannot select a newer draft of a published loop.',
    );
    expect(run).toContain(
      'do not run the published version as a substitute unless they explicitly confirm running the published version.',
    );
    expect(design).toContain('`allowDraft: true` cannot select a newer draft of a published loop.');
    expect(design).toContain('do not run the published version in its place');
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

  it('checks the runtime floor and rejects malformed or missing-entry invocations', async () => {
    await assembleClaudePlugin(packageDir, { outDir, mcpEntry: entry });
    const guard = join(outDir, 'check-runtime.cjs');
    const versionStub = join(scratch, 'stub-version.cjs');
    await writeFile(
      versionStub,
      "Object.defineProperty(process.versions, 'node', { value: process.env.GG_TEST_NODE_VERSION });\n",
    );
    await writeFile(entry, "console.log('fixture-entry-ran');\n");

    const runWithSimulatedVersion = (nodeVersion: string, entryPath: string) => {
      const env: NodeJS.ProcessEnv = { ...process.env, GG_TEST_NODE_VERSION: nodeVersion };
      delete env.GG_NODE_BINARY;
      return spawnSync(
        process.execPath,
        ['--require', versionStub, '--require', guard, entryPath],
        { encoding: 'utf8', env },
      );
    };

    const simulatedCases = [
      { version: '22.22.2', accepted: true },
      { version: '22.22.1', accepted: false },
      { version: '21.99.99', accepted: false },
      { version: '23.0.0', accepted: false },
      { version: '22.invalid.0', accepted: false },
    ];
    for (const { version, accepted } of simulatedCases) {
      const result = runWithSimulatedVersion(version, entry);
      expect(result.error, `simulated Node ${version} should spawn`).toBeUndefined();
      if (accepted) {
        expect(result.status, `simulated Node ${version} is at the supported floor`).toBe(0);
        expect(result.stdout).toContain('fixture-entry-ran');
      } else {
        expect(result.status, `simulated Node ${version} should be refused`).toBe(1);
        expect(result.stderr).toContain('requires Node 22.22.2 or later in major 22');
        expect(result.stdout).not.toContain('fixture-entry-ran');
      }
    }

    const missing = runWithSimulatedVersion('22.22.2', join(scratch, 'missing-entry.js'));
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('could not find its MCP entry');

    const noEntryEnv: NodeJS.ProcessEnv = { ...process.env, GG_TEST_NODE_VERSION: '22.22.2' };
    delete noEntryEnv.GG_NODE_BINARY;
    const noEntry = spawnSync(process.execPath, ['--require', versionStub, '--require', guard], {
      encoding: 'utf8',
      env: noEntryEnv,
      input: '',
    });
    expect(noEntry.status).toBe(1);
    expect(noEntry.stderr).toContain('could not find its MCP entry');
  });

  it('runs the generated default node command from PATH with this native Node runtime', async () => {
    await assembleClaudePlugin(packageDir, { outDir, mcpEntry: entry });
    const config = JSON.parse(await readFile(join(outDir, '.mcp.json'), 'utf8'));
    const command = config.mcpServers.graphgoblin.command as string;
    expect(command).toBe('${GG_NODE_BINARY:-node}');

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GG_NODE_BINARY;
    const selectedNode = spawnSync('node', ['-p', 'process.execPath'], {
      encoding: 'utf8',
      env,
    });
    expect(selectedNode.status).toBe(0);
    expect(await realpath(selectedNode.stdout.trim())).toBe(await realpath(process.execPath));
    const selectedVersion = spawnSync('node', ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      env,
    });
    expect(selectedVersion.status).toBe(0);
    expect(selectedVersion.stdout.trim()).toBe(process.versions.node);
    const major = Number(process.versions.node.split('.')[0]);
    const minor = Number(process.versions.node.split('.')[1]);
    const patch = Number(process.versions.node.split('.')[2]);
    expect(major).toBe(22);
    expect(minor > 22 || (minor === 22 && patch >= 2)).toBe(true);

    await writeFile(entry, "console.log('fixture-entry-ran');\n");
    const actual = spawnSync('node', ['--require', join(outDir, 'check-runtime.cjs'), entry], {
      encoding: 'utf8',
      env,
    });
    expect(actual.error).toBeUndefined();
    expect(actual.status).toBe(0);
    expect(actual.stdout).toContain('fixture-entry-ran');
    expect(actual.stderr).toBe('');
  });

  it('refuses assembly when the shared design skill no longer has its draft boundary', () => {
    expect(() => adaptSkill('design-loop', '---\r\nchanged source\r\n', '')).toThrow(
      /has no shared draft section/,
    );
    expect(() => adaptSkill('run-loop', '# No frontmatter\n', '')).toThrow(/has no frontmatter/);
    expect(() => adaptSkill('run-loop', '---\r\nname: run-loop\r\n---\r\n', '')).toThrow(
      'missing the Claude adaptation anchors "## 1. Find the loop" and "start it from the draft (`allowDraft: true`) only if they agree."',
    );
  });

  it('adapts CRLF shared skills to the same text as LF', async () => {
    for (const name of skillNames) {
      const shared = join(defaultPaths(packageDir).sharedSkills, name, 'SKILL.md');
      const lf = (await readFile(shared, 'utf8')).replace(/\r\n/g, '\n');
      expect(adaptSkill(name, lf.replace(/\n/g, '\r\n'), 'draft\n')).toBe(
        adaptSkill(name, lf, 'draft\n'),
      );
    }
  });

  it('refuses each missing run-loop anchor before replacing an owned output', async () => {
    const { copy, paths } = await copyPackage(join(scratch, 'copy'));
    await assembleClaudePlugin(copy, { outDir, mcpEntry: entry });
    const before = await snapshot(outDir);
    expect(before['.graphgoblin-plugin-output.json']).toContain('"kind":"claude-plugin"');
    const runLoop = join(paths.sharedSkills, 'run-loop', 'SKILL.md');
    const original = await readFile(runLoop, 'utf8');
    for (const [anchor, replacement] of [
      ['## 1. Find the loop', '## 1. Locate the loop'],
      [
        'start it from the draft (`allowDraft: true`) only if they agree.',
        'start it from the draft (`allowDraft: true`) only if they consent.',
      ],
    ] as const) {
      expect(original).toContain(anchor);
      await writeFile(runLoop, original.replace(anchor, replacement));
      await expect(assembleClaudePlugin(copy, { outDir, mcpEntry: entry })).rejects.toThrow(
        `The shared run-loop skill is missing the Claude adaptation anchor ${JSON.stringify(anchor)}. Restore the shared text or update the Claude run-loop adaptation, then assemble again`,
      );
      expect(await snapshot(outDir)).toEqual(before);
      expect(await readdir(scratch)).not.toContain('.output.graphgoblin-build');
    }
    // With the shared text restored, a rebuild produces the same bytes and ownership marker.
    await writeFile(runLoop, original);
    await assembleClaudePlugin(copy, { outDir, mcpEntry: entry });
    expect(await snapshot(outDir)).toEqual(before);
  });

  it('refuses unsupported plugin, shared skill and README inputs before changing the output', async () => {
    const { copy, paths } = await copyPackage(join(scratch, 'copy'));
    await assembleClaudePlugin(copy, { outDir, mcpEntry: entry });
    const before = await snapshot(outDir);
    const assemble = () => assembleClaudePlugin(copy, { outDir, mcpEntry: entry });

    await writeFile(join(paths.pluginDir, 'notes.md'), 'not packaged');
    await expect(assemble()).rejects.toThrow(
      `Unsupported plugin source entries in "${paths.pluginDir}": "notes.md". This builder packages only ".claude-plugin/plugin.json", "check-runtime.cjs", "design-draft.md" from this folder. Move the unsupported entries out of it, or add explicit builder support for them, then assemble again`,
    );
    await rm(join(paths.pluginDir, 'notes.md'));

    const shared = join(paths.sharedSkills, 'run-loop');
    await writeFile(join(shared, 'reference.md'), 'supporting reference');
    await mkdir(join(shared, 'scripts'));
    await writeFile(join(shared, 'scripts', 'collect.sh'), 'echo');
    await expect(assemble()).rejects.toThrow(
      `Unsupported plugin source entries in "${paths.sharedSkills}": "run-loop/reference.md", "run-loop/scripts/". This builder packages only "design-loop/SKILL.md", "inspect-run/SKILL.md", "run-loop/SKILL.md" from this folder.`,
    );
    await rm(join(shared, 'reference.md'));
    await rm(join(shared, 'scripts'), { recursive: true });

    // Another shared skill is refused rather than silently left out of the Claude plugin.
    await cp(join(paths.sharedSkills, 'run-loop'), join(paths.sharedSkills, 'review-loop'), {
      recursive: true,
    });
    await expect(assemble()).rejects.toThrow(`: "review-loop/". This builder packages only`);
    await rm(join(paths.sharedSkills, 'review-loop'), { recursive: true });

    const readme = join(copy, 'README.md');
    await rm(readme);
    await mkdir(readme);
    await expect(assemble()).rejects.toThrow(
      `Unsupported plugin source entry "${readme}": the package README.md must be a regular file, and links are not followed`,
    );
    expect(await snapshot(outDir)).toEqual(before);
    expect(await readdir(scratch)).not.toContain('.output.graphgoblin-build');
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
    const { copy: fakePackage, paths } = await copyPackage(scratch);
    await mkdir(join(scratch, 'apps', 'mcp', 'dist'), { recursive: true });
    await writeFile(paths.mcpEntry, '');
    expect(await run([], fakePackage, () => {})).toBe(0);
    expect(await readFile(join(paths.outDir, '.mcp.json'), 'utf8')).toContain(
      paths.mcpEntry.split(sep).join('/'),
    );
  });
});
