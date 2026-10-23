// Prepare unchanged repository history specs on allocated ports, using the built API/web.
// Usage: node this-file.mjs > a-root-path-file; run pnpm's Playwright CLI with that config.
import fs from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const root = await mkdtemp(join(tmpdir(), 'gg-wp-g2-round8-edge-'));
const requireWeb = createRequire(join(repo, 'apps/web/package.json'));
const importPath = (specifier) => {
  const workspace = {
    '@graphgoblin/api': 'apps/api/dist/index.js',
    '@graphgoblin/api/testing': 'apps/api/dist/testing/test-app.js',
    '@graphgoblin/contracts': 'packages/contracts/dist/index.js',
    '@graphgoblin/contracts/testing': 'packages/contracts/dist/testing/index.js',
    '@graphgoblin/engine': 'packages/engine/dist/index.js',
    '@graphgoblin/engine/testing': 'packages/engine/dist/testing/index.js',
  };
  if (workspace[specifier]) return pathToFileURL(join(repo, workspace[specifier])).href;
  if (!specifier.startsWith('.') && !specifier.startsWith('node:')) {
    const resolved = requireWeb.resolve(specifier);
    const esm = resolved.replace(/\.cjs$/, '.js');
    const module = resolved.replace(/\.[cm]?js$/, '.mjs');
    return pathToFileURL(fs.existsSync(module) ? module : fs.existsSync(esm) ? esm : resolved).href;
  }
  if (specifier.startsWith('../src/')) {
    const source = join(repo, 'apps/web/src', specifier.slice(7));
    return pathToFileURL(fs.existsSync(source) ? source : source.replace(/\.js$/, '.ts')).href;
  }
  return specifier;
};
for (const name of ['history.spec.ts', 'fixtures.ts', 'server.ts', 'global-setup.ts']) {
  let text = fs.readFileSync(join(repo, 'apps/web/e2e', name), 'utf8');
  text = text.replace(/from '([^']+)'/g, (_, specifier) => `from '${importPath(specifier)}'`);
  if (name === 'server.ts') {
    text = text.replace(
      "resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')",
      "join(process.env['GG_WP_G2_REPO']!, 'apps/web/dist')",
    );
    text = text.replace('port: 0', 'port: 5622 + instances.size + (instances.size > 0 ? 1 : 0)');
    text = text.replace('controlServer.listen(0,', 'controlServer.listen(5623,');
    // The shared fixture owns a fresh gg-api directory inside this explicitly owned parent.
  }
  if (name === 'global-setup.ts') {
    text = text.replace(
      'cwd: webRoot,',
      `cwd: webRoot, env: { ...process.env, TEMP: ${JSON.stringify(root)}, TMP: ${JSON.stringify(root)} },`,
    );
    text = text.replace(
      "resolve(dirname(fileURLToPath(import.meta.url)), '..')",
      "resolve(process.env['GG_WP_G2_REPO']!, 'apps/web')",
    );
    text = text.replace(
      "['--conditions=development', '--import', 'tsx', 'e2e/server.ts']",
      JSON.stringify([
        '--import',
        pathToFileURL(requireWeb.resolve('tsx')).href,
        join(root, 'server.ts'),
      ]),
    );
  }
  fs.writeFileSync(join(root, name), text);
}
fs.writeFileSync(
  join(root, 'playwright.config.ts'),
  `
import { defineConfig, devices } from '${importPath('@playwright/test')}';
export default defineConfig({ testDir: '.', testMatch: 'history.spec.ts', globalSetup: './global-setup.ts',
  workers: 1, retries: 0, timeout: 60000, expect: { timeout: 10000 }, reporter: [['list']],
  outputDir: ${JSON.stringify(join(root, 'output'))}, use: { serviceWorkers: 'allow', viewport: {width:1440,height:900} },
  projects: [{ name: 'edge', use: {...devices['Desktop Chrome'], channel: 'msedge', viewport:{width:1440,height:900}} }] });
`,
);
fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
console.log(root);
