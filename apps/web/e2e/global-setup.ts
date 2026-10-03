import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Start e2e/server.ts in a child process (TypeScript through tsx, workspace packages from source)
 * and hand its ephemeral URL to the tests through GG_E2E_BASE_URL. Returns the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const child = spawn(
    process.execPath,
    ['--conditions=development', '--import', 'tsx', 'e2e/server.ts'],
    {
      cwd: webRoot,
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );

  const url = await new Promise<string>((resolveUrl, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error('the E2E server did not start within 60 s')),
      60_000,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const match = /GG_E2E_READY (\S+)/.exec(buffer);
      if (match?.[1]) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the E2E server exited early with code ${String(code)}`));
    });
  });
  process.env['GG_E2E_BASE_URL'] = url;

  return async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.stdin.end('stop\n');
    const timeout = new Promise((r) => setTimeout(r, 10_000));
    await Promise.race([exited, timeout]);
    if (child.exitCode === null) child.kill();
  };
}
