import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { INSTANCE_PROTOCOL, instanceIdentity } from './instance-identity.js';
import { LAUNCHER_LOG_DIR_VARIABLE } from './windows-log/managed-root.js';
import { takeLauncherLogDirectory } from './windows-log/guard.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

const source = fileURLToPath(new URL('./', import.meta.url));

it('imports inertly: the reserved variable stays and nothing starts', async () => {
  vi.stubEnv(LAUNCHER_LOG_DIR_VARIABLE, 'C:\\inert import');
  vi.resetModules();
  const entry = await import('./main.js');
  expect(entry.WINDOWS_LAUNCHER_LOG_PROTOCOL).toBe(1);
  expect(typeof entry.main).toBe('function');
  expect(process.env[LAUNCHER_LOG_DIR_VARIABLE]).toBe('C:\\inert import');
});

it('declares the exact launcher protocol marker within the first 4 KiB of the entry', async () => {
  const text = (await readFile(join(source, 'main.ts'))).subarray(0, 4096).toString('utf8');
  expect(text).toContain('export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;');
});

/**
 * The guarded entry's static import closure is Node built-ins and the built-ins-only guard. Every
 * dependency-bearing module is reached only through a dynamic import after admission.
 */
it('statically imports only Node built-ins before managed admission', async () => {
  const seen = new Map<string, string[]>();
  const pending = [join(source, 'main.ts')];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    const text = await readFile(file, 'utf8');
    const imports = [...text.matchAll(/^import\s+(?!type\b)[\s\S]*?\sfrom\s+'([^']+)';/gm)].map(
      (match) => match[1]!,
    );
    seen.set(file, imports);
    for (const specifier of imports) {
      if (specifier.startsWith('node:')) continue;
      expect(specifier.startsWith('./') || specifier.startsWith('../')).toBe(true);
      pending.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
    }
  }
  expect(
    [...seen.keys()].map((file) => file.slice(source.length).replaceAll('\\', '/')).sort(),
  ).toEqual([
    'entry-point.ts',
    'main.ts',
    'windows-log/gateway-log-writer.ts',
    'windows-log/guard.ts',
    'windows-log/managed-root.ts',
  ]);
  const main = await readFile(join(source, 'main.ts'), 'utf8');
  for (const dynamic of ['./serve.js', './preflight.js', './create-api-key.js', './reset/reset.js'])
    expect(main).toContain(`import('${dynamic}')`);
});

it('keeps the reserved variable out of configuration and the instance fingerprint', () => {
  const base = { GG_DATA_DIR: resolve('/fingerprint/store'), GG_PORT: '4831' };
  const withVariable: NodeJS.ProcessEnv = { ...base, gg_Windows_Launcher_Log_Dir: 'C:\\logs' };
  const config = loadConfig(withVariable);
  expect(JSON.stringify(config)).not.toContain('C:\\\\logs');
  expect(instanceIdentity(config)).toBe(instanceIdentity(loadConfig(base)));
  expect(takeLauncherLogDirectory(withVariable)).toBe('C:\\logs');
  expect(withVariable).toEqual(base);
  expect(INSTANCE_PROTOCOL).toBe(2);
});
