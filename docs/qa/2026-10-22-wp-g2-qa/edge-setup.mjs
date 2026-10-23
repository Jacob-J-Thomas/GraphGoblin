import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export default async function setup() {
  const child = spawn(process.execPath, [join(process.env.GG_QA_TEMP_ROOT, 'e2e-server.mjs')], {
    cwd: join(root, 'apps/web'),
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });
  await new Promise((ok, bad) => {
    let buffer = '';
    const timer = setTimeout(() => bad(Error('E2E readiness deadline60s')), 60000);
    child.stdout.on('data', (b) => {
      buffer += b;
      const a = /GG_E2E_READY (\S+)/.exec(buffer),
        c = /GG_E2E_CONTROL (\S+)/.exec(buffer);
      if (c) process.env.GG_E2E_CONTROL_URL = c[1];
      if (a) {
        process.env.GG_E2E_BASE_URL = a[1];
        clearTimeout(timer);
        ok();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      bad(Error('E2E server exit ' + code));
    });
  });
  return async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.stdin.end('stop\n');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]);
    if (child.exitCode === null) child.kill();
  };
}
