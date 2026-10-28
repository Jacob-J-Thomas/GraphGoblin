// Reviewer baseline (WP-425): build the web app with main's (a4fee9a9) versions of every runtime
// module the branch changed, read from Git objects; the worktree's source is not touched.
// Run from apps/web: pnpm exec vite build --config <this file>
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import base from '%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/agent-ac1d90d26b904089d/apps/web/vite.config.ts';

const root = '%USERPROFILE%/source/repos/GraphGoblin/.claude/worktrees/agent-ac1d90d26b904089d';
const outDir = process.env['REV425_MAIN_DIST'];
if (!outDir || !outDir.includes('gg-rev425-'))
  throw new Error('REV425_MAIN_DIST must name a gg-rev425- directory');
const changed = execFileSync(
  'git',
  ['diff', '--name-only', 'a4fee9a9', 'HEAD', '--', 'apps/web/src'],
  { cwd: root, encoding: 'utf8' },
)
  .split('\n')
  .filter((file) => file && !/\.test\.tsx?$/.test(file))
  .filter((file) => !/(edge-label-placement|node-placement)\.ts$/.test(file));
const modules = new Map(
  changed.map((file) => [
    file,
    execFileSync('git', ['show', `a4fee9a9:${file}`], { cwd: root, encoding: 'utf8' }),
  ]),
);
console.log('baseline modules from a4fee9a9:', [...modules.keys()].join(', '));

export default {
  ...base,
  plugins: [
    {
      name: 'rev425-main-source',
      enforce: 'pre',
      load(id) {
        return modules.get(relative(root, id.split('?')[0]).replaceAll('\\', '/'));
      },
    },
    ...base.plugins,
  ],
  build: { ...base.build, outDir, emptyOutDir: true },
};
