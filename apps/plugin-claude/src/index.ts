import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { writePluginOutput } from '@graphgoblin/tooling/plugin-output';

const skills = ['design-loop', 'inspect-run', 'run-loop'] as const;
type Skill = (typeof skills)[number];
const manifest = '.claude-plugin/plugin.json';
const runtimeGuard = 'check-runtime.cjs';

export function defaultPaths(packageDir: string) {
  return {
    pluginDir: resolve(packageDir, 'plugin'),
    sharedSkills: resolve(packageDir, '..', 'plugin-codex', 'plugin', 'graphgoblin', 'skills'),
    outDir: resolve(packageDir, 'dist', 'plugin', 'graphgoblin'),
    mcpEntry: resolve(packageDir, '..', 'mcp', 'dist', 'main.js'),
  };
}

/** Adapt the shared skill text to Claude's invocation syntax and the draft tools. */
export function adaptSkill(name: Skill, markdown: string, designInstructions: string): string {
  let adapted = markdown
    .replace(/\r\n/g, '\n')
    .replace(
      'the `graphgoblin` MCP tools',
      "Claude Code's `plugin:graphgoblin:graphgoblin` MCP tools",
    )
    .replace(/\$(design-loop|run-loop|inspect-run)\b/g, '/graphgoblin:$1');
  if (!adapted.startsWith('---\n')) throw new Error('The shared skill has no frontmatter');
  if (name === 'design-loop') {
    const draftSection = '\n## 3. Validate and save as a draft\n';
    const start = adapted.indexOf(draftSection);
    if (start === -1) throw new Error('The design-loop skill has no shared draft section');
    adapted = adapted
      .slice(0, start)
      .replace(' Never publishes unless the user explicitly asks.', '')
      .replace(
        /Do not publish it unless the user explicitly asks you to; publishing freezes a version that triggers and other loops will run\./,
        'This workflow saves the draft and reports validation issues.',
      );
    adapted += draftSection + '\n' + designInstructions;
  } else if (name === 'run-loop') {
    adapted = adapted
      .replace(
        '## 1. Find the loop',
        [
          'Only start a run when the user explicitly requests one. An ambiguous request or a failed',
          'response after starting a run is a reason to check its current state before retrying.',
          'On `FORBIDDEN`, report the gateway scope required for the operation.',
          '',
          '## 1. Find the loop',
        ].join('\n'),
      )
      .replace(
        'start it from the draft (`allowDraft: true`) only if they agree.',
        'start it from the draft (`allowDraft: true`) only if they explicitly requested the draft or confirmed draft execution.',
      );
  }
  if (name !== 'inspect-run')
    adapted = adapted.replace(/^---\n/, '---\ndisable-model-invocation: true\n');
  return adapted;
}

/** Assemble the Claude-native local artifact from the built MCP entry. */
export async function assembleClaudePlugin(
  packageDir: string,
  overrides: { outDir?: string | undefined; mcpEntry?: string | undefined } = {},
): Promise<string> {
  const defaults = defaultPaths(packageDir);
  const mcpEntry = resolve(overrides.mcpEntry ?? defaults.mcpEntry);
  if (!statSync(mcpEntry, { throwIfNoEntry: false })?.isFile())
    throw new Error(`GraphGoblin MCP entry is missing at "${mcpEntry}". Run pnpm build first.`);
  const [documentation, designInstructions, manifestBytes, guardBytes] = await Promise.all([
    readFile(join(packageDir, 'README.md')),
    readFile(join(defaults.pluginDir, 'design-draft.md'), 'utf8'),
    readFile(join(defaults.pluginDir, manifest)),
    readFile(join(defaults.pluginDir, runtimeGuard)),
  ]);
  const skillFiles = await Promise.all(
    skills.map(async (name) => {
      const file = `skills/${name}/SKILL.md`;
      const markdown = await readFile(join(defaults.sharedSkills, name, 'SKILL.md'), 'utf8');
      return [file, adaptSkill(name, markdown, designInstructions)] as const;
    }),
  );
  const mcp = {
    mcpServers: {
      graphgoblin: {
        type: 'stdio',
        command: '${GG_NODE_BINARY:-node}',
        args: [
          '--require',
          '${CLAUDE_PLUGIN_ROOT}/' + runtimeGuard,
          mcpEntry.split(sep).join('/'),
          '--draft-tools',
        ],
      },
    },
  };
  return writePluginOutput({
    outDir: overrides.outDir ?? defaults.outDir,
    packageDir,
    defaultOutDir: defaults.outDir,
    protectedPaths: [defaults.pluginDir, defaults.sharedSkills, mcpEntry],
    kind: 'claude-plugin',
    files: {
      [manifest]: manifestBytes,
      [runtimeGuard]: guardBytes,
      'README.md': documentation,
      '.mcp.json': `${JSON.stringify(mcp, null, 2)}\n`,
      ...Object.fromEntries(skillFiles),
    },
  });
}
