// Reviewer baseline (WP-425 scan 2): build apps/web with main's (a4fee9a9) version of every
// runtime module the branch changed that exists on main, read from Git objects. The worktree's
// source is not touched. Run from apps/web:
//   REV425B_MAIN_DIST=%TEMP%\gg-rev425b-main-dist pnpm exec vite build --config <this file>
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../../../../../apps/web/vite.config.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const outDir = process.env['REV425B_MAIN_DIST'];
if (!outDir || !outDir.includes('gg-rev425b-'))
  throw new Error('REV425B_MAIN_DIST must name a gg-rev425b- directory');
const changed = execFileSync(
  'git',
  ['diff', '--name-only', 'a4fee9a9', 'HEAD', '--', 'apps/web/src'],
  { cwd: root, encoding: 'utf8' },
)
  .split('\n')
  .filter((file) => file && !/\.test\.tsx?$/.test(file));
const modules = new Map();
for (const file of changed) {
  try {
    modules.set(
      file,
      execFileSync('git', ['show', `a4fee9a9:${file}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    // New on the branch; main's modules do not import it.
  }
}
console.log('baseline modules from a4fee9a9:', [...modules.keys()].join(', '));

export default {
  ...base,
  plugins: [
    {
      name: 'rev425b-main-source',
      enforce: 'pre',
      load(id) {
        return modules.get(relative(root, id.split('?')[0]).replaceAll('\\', '/'));
      },
    },
    ...base.plugins,
  ],
  build: { ...base.build, outDir, emptyOutDir: true },
};
