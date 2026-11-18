import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

let portRoot: string | undefined;

export function setApiPortRoot(root: string): void {
  portRoot = root;
}

async function createDirectory(path: string): Promise<boolean> {
  try {
    await mkdir(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

async function generationReleased(path: string): Promise<boolean> {
  try {
    return (await lstat(join(path, 'released'))).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function claim(slot: string): Promise<(() => Promise<void>) | undefined> {
  // Generations stay until the Vitest run closes. Windows may report EPERM if
  // a worker tries to create a directory while another worker is deleting it.
  await createDirectory(slot);
  let latest = 0;
  for (const name of await readdir(slot)) {
    const generation = Number(name);
    if (Number.isSafeInteger(generation)) latest = Math.max(latest, generation);
  }
  if (latest > 0 && !(await generationReleased(join(slot, String(latest))))) return;

  // A peer can win after our snapshot. Exclusive creation decides the winner.
  const path = join(slot, String(latest + 1));
  if (!(await createDirectory(path))) return;
  const owner = join(path, randomUUID());
  await mkdir(owner);

  let released: Promise<void> | undefined;
  // Move only this lease's marker. A stale release cannot move another marker.
  return () => (released ??= rename(owner, join(path, 'released')));
}

function hasConflictingBind(port: number, host: string): Promise<boolean> {
  const server = createServer((socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(true);
      else if (
        host === '::' &&
        ['EAFNOSUPPORT', 'EPROTONOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code ?? '')
      )
        resolve(false);
      else reject(error);
    });
    server.listen(port, host, () => {
      server.close((error) => (error ? reject(error) : resolve(false)));
    });
  });
}

async function canBind(port: number): Promise<boolean> {
  // Windows permits certain overlapping wildcard and loopback bind pairs. Probe each separately.
  const hosts = process.platform === 'win32' ? ['127.0.0.1', '0.0.0.0', '::'] : ['127.0.0.1'];
  for (const host of hosts) {
    if (await hasConflictingBind(port, host)) return false;
  }
  return true;
}

/** Own a port among cooperating workers until the fixture has closed its listeners and children. */
export async function reserveApiPort(
  start = Number(process.env.GG_TEST_PORT_START ?? 5600),
  count = Number(process.env.GG_TEST_PORT_COUNT ?? 100),
) {
  const end = start + count - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    start < 1 ||
    count < 1 ||
    end > 65535
  ) {
    throw new Error(
      `Invalid disposable API port range (GG_TEST_PORT_START=${start}, GG_TEST_PORT_COUNT=${count}). Expected integer ports within 1-65535.`,
    );
  }

  const root = portRoot;
  if (!root) throw new Error('Disposable API ports require the API Vitest setup');
  const offset = Math.floor(Math.random() * count);
  for (let index = 0; index < count; index++) {
    const port = start + ((offset + index) % count);
    const release = await claim(join(root, String(port)));
    if (!release) continue;
    let available = false;
    try {
      available = await canBind(port);
    } finally {
      if (!available) await release();
    }
    if (available) return { port, release };
  }
  throw new Error(
    `No disposable API port is available in ${start}-${end}. Ports are reserved by tests or in use. Assign a larger free range or reduce concurrent API tests.`,
  );
}
