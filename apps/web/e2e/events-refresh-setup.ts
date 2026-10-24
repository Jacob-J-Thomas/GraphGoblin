import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A real built API and SQLite store; leave the disposable directory for orchestrator cleanup. */
export default async function setup(): Promise<() => Promise<void>> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const store = await mkdtemp(join(tmpdir(), 'gg-wp-g2-240-browser-'));
  const url = 'http://127.0.0.1:5921';
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      GG_PORT: '5921',
      GG_DATA_DIR: store,
      GG_WEB_DIST: resolve(root, 'apps/web/dist'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostic = '';
  const capture = (chunk: Buffer) => {
    diagnostic = (diagnostic + chunk.toString()).slice(-64_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  };
  try {
    for (let i = 0; ; i++) {
      if (
        await fetch(url + '/healthz', { signal: AbortSignal.timeout(2_000) })
          .then((response) => response.ok)
          .catch(() => false)
      )
        break;
      if (i === 120 || child.exitCode !== null)
        throw new Error('Built API startup failed: ' + diagnostic);
      await new Promise((done) => setTimeout(done, 250));
    }
    process.env['GG_E2E_BASE_URL'] = url;
    // The default suite uses isolated control-server apps; this setup supplies a built API.
    delete process.env['GG_E2E_CONTROL_URL'];
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}
