import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export default async function setup() {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./edge-server.ts', import.meta.url))],
    {
      cwd: fileURLToPath(new URL('../../../../apps/web', import.meta.url)),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  const exited = once(child, 'exit');
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(
        () => reject(new Error('E2E server did not start within 60 s')),
        60000,
      );
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        const control = /GG_E2E_CONTROL (\S+)/.exec(buffer);
        if (control?.[1]) process.env.GG_E2E_CONTROL_URL = control[1];
        const ready = /GG_E2E_READY (\S+)/.exec(buffer);
        if (ready?.[1]) {
          clearTimeout(timer);
          resolve(ready[1]);
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error('E2E server exited ' + code));
      });
    });
    process.env.GG_E2E_BASE_URL = url;
  } catch (error) {
    child.kill();
    await exited;
    throw error;
  }
  return async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end('stop\n');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await exited;
      }
    }
    await writeFile(
      new URL('./edge-process.json', import.meta.url),
      JSON.stringify(
        {
          pid: child.pid,
          exitObserved: true,
          exitCode: child.exitCode,
          signalCode: child.signalCode,
        },
        null,
        2,
      ) + '\n',
    );
  };
}
