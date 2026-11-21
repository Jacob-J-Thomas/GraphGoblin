// Probe 00b: load Vitest's ESM entry (probe 00 resolved the CommonJS stub, which refuses require()).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_API = process.argv[2];
const req = createRequire(`${REPO_API}/package.json`);
const pkgJson = req.resolve('vitest/package.json');
const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'));
const entry = pkg.exports['.'];
const esmRel = typeof entry === 'string' ? entry : (entry.import?.default ?? entry.import ?? entry.default);
const esm = join(dirname(pkgJson), esmRel);
const out = { vitestVersion: pkg.version, esmEntry: esm };
try {
  const { expect } = await import(pathToFileURL(esm).href);
  expect(1).toBe(1);
  const results = {};
  const t = (name, fn) => {
    try {
      fn();
      results[name] = 'passed';
    } catch (e) {
      results[name] = `threw ${e.name}`;
    }
  };
  t('toBe(true) on true', () => expect(true).toBe(true));
  t('toBe(true) on undefined', () => expect(undefined).toBe(true));
  t('toBe(0) on 0', () => expect(0).toBe(0));
  t('toBe(0) on 32', () => expect(32).toBe(0));
  t('toEqual buffer mismatch', () => expect(Buffer.from([1])).toEqual(Buffer.from([2])));
  t('toEqual buffer same', () => expect(Buffer.from([1])).toEqual(Buffer.from([1])));
  t('toEqual extra empty wal key', () =>
    expect({ db: Buffer.from([1]), wal: Buffer.alloc(0) }).toEqual({ db: Buffer.from([1]) }),
  );
  t('toEqual same map', () =>
    expect({ db: Buffer.from([1]) }).toEqual({ db: Buffer.from([1]) }),
  );
  out.results = results;
} catch (e) {
  out.error = `${e.name}: ${e.message}`;
}
console.log(JSON.stringify(out, null, 2));
