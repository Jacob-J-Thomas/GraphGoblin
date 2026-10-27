import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const base = path.join(process.env.GG_QA_ROOT, 'baseline-main');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@graphgoblin/')) {
    const [pkg, ...rest] = specifier.slice('@graphgoblin/'.length).split('/');
    const dir = path.join(base, pkg === 'api' ? 'apps' : 'packages', pkg);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const key = rest.length ? './' + rest.join('/') : '.';
    const exp = manifest.exports[key];
    return {
      url: pathToFileURL(path.resolve(dir, typeof exp === 'string' ? exp : exp.import)).href,
      shortCircuit: true,
    };
  }
  if (
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('node:') &&
    !specifier.startsWith('file:') &&
    context.parentURL?.startsWith(pathToFileURL(base).href)
  ) {
    const parent = path.join(repo, path.relative(base, fileURLToPath(context.parentURL)));
    return nextResolve(specifier, { ...context, parentURL: pathToFileURL(parent).href });
  }
  return nextResolve(specifier, context);
}
