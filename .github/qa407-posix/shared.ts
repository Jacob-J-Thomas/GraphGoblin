import { readFile, readdir, rename, realpath, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { dirname, join } from 'node:path';
import { expect, inject } from 'vitest';
import { reserveApiPort } from '../testing/api-port.js';
import { eventually } from '../testing/api-subprocess.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('Missing witness variable ' + name);
  return value;
}
const sync = required('GG_407_SYNC');
const startPort = Number(required('GG_TEST_PORT_START'));
if (!Number.isInteger(startPort) || startPort !== 18470 || required('GG_TEST_PORT_COUNT') !== '20') {
  throw new Error('Unexpected disposable witness port range');
}
export const ports = { generation: startPort, wildcard: startPort + 1, api: startPort + 2 };
export async function root(): Promise<string> {
  const value = await realpath(inject('apiPortRoot'));
  if (dirname(value) !== await realpath(required('TMPDIR'))) {
    throw new Error('Injected root is outside the witness-owned temporary directory');
  }
  return value;
}

export async function phase(name: string, fields: Record<string, string | number | boolean | null> = {}) {
  const path = join(sync, name + '.json');
  const message = { ...fields, workerPid: process.pid };
  await writeFile(path + '.new', JSON.stringify(message), { flag: 'wx' });
  await rename(path + '.new', path);
  console.info('GG407 ' + JSON.stringify({ phase: name, ...message }));
}

export async function waitPhase(name: string): Promise<Record<string, unknown>> {
  let body: string | undefined;
  await eventually(async () => {
    try {
      body = await readFile(join(sync, name + '.json'), 'utf8');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }, 8_000);
  if (body === undefined) throw new Error('No witness phase data for ' + name);
  const value: unknown = JSON.parse(body);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid witness phase data');
  }
  return value as Record<string, unknown>;
}

export async function checkPeer(name: string, ownRoot: string) {
  const peer = await waitPhase(name);
  expect(typeof peer.workerPid).toBe('number');
  expect(peer.workerPid).not.toBe(process.pid);
  expect(peer.root).toBe(ownRoot);
}

export function markers(rootPath: string, port: number, generation: number) {
  return readdir(join(rootPath, String(port), String(generation)));
}

export async function reserveAttempt(port: number): Promise<'granted' | 'refused'> {
  let lease;
  try {
    lease = await reserveApiPort(port, 1);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(
      'No disposable API port is available in ' + port + '-' + port + '.'
    )) return 'refused';
    throw error;
  }
  await lease.release();
  return 'granted';
}

export async function listen(server: Server, port: number, host: string) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

export async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function probeLoopback(port: number): Promise<'bind-succeeded' | 'EADDRINUSE'> {
  const server = createServer((socket) => socket.destroy());
  try {
    await listen(server, port, '127.0.0.1');
    return 'bind-succeeded';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') return 'EADDRINUSE';
    throw error;
  } finally {
    await close(server);
  }
}
