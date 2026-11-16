// Reviewer-local Node semantics probe. It imports no product code and writes nothing.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = process.argv[1];
const meta = fileURLToPath(import.meta.url);
const tryReal = (fn, path) => {
  try {
    return fn(path);
  } catch (error) {
    return `ERR:${error.code ?? error.name}`;
  }
};
const nativeEqual = (() => {
  if (!entry) return false;
  try {
    return realpathSync.native(entry) === realpathSync.native(meta);
  } catch {
    return false;
  }
})();
process.stdout.write(
  JSON.stringify({
    argv1: entry ?? null,
    importMetaPath: meta,
    oldResolveGuard: Boolean(entry) && resolve(entry) === meta,
    newNativeGuard: nativeEqual,
    jsRealpathGuard: Boolean(entry) && tryReal(realpathSync, entry) === tryReal(realpathSync, meta),
    nativeArgv1: entry ? tryReal(realpathSync.native, entry) : null,
  }) + '\n',
);
