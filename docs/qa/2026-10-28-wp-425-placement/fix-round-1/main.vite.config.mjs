// Read baseline modules from Git objects in this worktree; never switch or rewrite source.
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../../../../apps/web/vite.config.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const files = [
  'apps/web/src/editor/Canvas.tsx',
  'apps/web/src/editor/useRouting.ts',
  'apps/web/src/editor/OrthogonalEdge.tsx',
  'apps/web/src/editor/Palette.tsx',
  'apps/web/src/editor/route-channels.ts',
  'apps/web/src/editor/routing-geometry.ts',
  'apps/web/src/styles/canvas-routes.css',
];
const modules = new Map(
  files.map((file) => [
    file,
    execFileSync('git', ['show', `a4fee9a9:${file}`], { cwd: root, encoding: 'utf8' }),
  ]),
);
const outDir = process.env['GG_425_MAIN_DIST'];
if (!outDir) throw new Error('GG_425_MAIN_DIST must name a disposable gg-425- directory');

export default {
  ...base,
  plugins: [
    {
      name: 'gg-425-main-source',
      enforce: 'pre',
      load(id) {
        return modules.get(relative(root, id.split('?')[0]).replaceAll('\\', '/'));
      },
    },
    ...base.plugins,
  ],
  build: { ...base.build, outDir, emptyOutDir: false },
};
