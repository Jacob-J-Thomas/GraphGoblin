// Resolve archived workspace modules to their own build; borrow unchanged installed externals.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
const base = process.env.GG_WP_D2_BASE_ROOT;
const current = process.env.GG_WP_D2_CURRENT_ROOT;
if (!base || !current) throw Error('Archive/current roots are required.');
const packages = new Map();
for (const folder of ['packages', 'apps']) {
  for (const entry of readdirSync(join(base, folder), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(base, folder, entry.name);
    try {
      const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      packages.set(metadata.name, { root, metadata });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@graphgoblin/')) {
    const [scope, name, ...path] = specifier.split('/');
    const found = packages.get(scope + '/' + name);
    const exported = found?.metadata.exports[path.length ? './' + path.join('/') : '.'];
    const target = typeof exported === 'string' ? exported : exported?.import;
    if (!target) throw Error('No archived export for ' + specifier);
    return { url: pathToFileURL(join(found.root, target)).href, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':'))
      throw error;
    const parent = context.parentURL && fileURLToPath(context.parentURL);
    const found =
      parent &&
      [...packages.values()].find(
        ({ root }) => parent.startsWith(root + '\\') || parent.startsWith(root + '/'),
      );
    const importer = found
      ? resolvePath(current, relative(base, found.root), 'package.json')
      : join(current, 'package.json');
    return nextResolve(specifier, { ...context, parentURL: pathToFileURL(importer).href });
  }
}
