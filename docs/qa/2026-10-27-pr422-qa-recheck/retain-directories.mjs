// QA-only preload: retain disposable fixture directories; never delete a directory.
// Assertions and product execution are unchanged. Every skipped cleanup is disclosed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
const original = fsp.rm;
const retained = (p) => {
  const value = path.resolve(String(p));
  const relative = path.relative(os.tmpdir(), value);
  if ((relative && !relative.startsWith('gg-qa-422r-') && !path.resolve(os.tmpdir()).includes('gg-qa-422r-')) || relative.includes('..') || path.isAbsolute(relative))
    throw Error('QA cleanup outside disposable prefix refused');
  console.error('QA_RETAIN_DIRECTORY ' + value);
};
fsp.rm = async (p, options) => {
  if (options?.recursive || fs.existsSync(p) && fs.statSync(p).isDirectory()) return retained(p);
  return original(p, options);
};
const originalCallback = fs.rm;
fs.rm = (p, options, callback) => {
  if (options?.recursive || fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    retained(p); callback?.(null); return;
  }
  return originalCallback(p, options, callback);
};
syncBuiltinESMExports();
