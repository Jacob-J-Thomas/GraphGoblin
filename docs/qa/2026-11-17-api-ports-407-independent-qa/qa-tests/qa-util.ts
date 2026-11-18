// Disposable independent-QA helper for #407. Not candidate code; deleted after the QA session.
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reserveApiPort } from '../testing/api-port.js';

export function qaEnv() {
  const sync = process.env.QA407_SYNC;
  const out = process.env.QA407_OUT;
  if (!sync || !out) throw new Error('QA407_SYNC and QA407_OUT are required for QA files');
  if (!/qa407/i.test(sync) || !/qa407|independent-claude-qa/i.test(out))
    throw new Error(`Refusing unexpected QA paths ${sync} ${out}`);
  return { sync, out };
}

export function qa(scenario: string, role: string) {
  const { sync, out } = qaEnv();
  const file = join(out, `${scenario}-observations.jsonl`);
  return {
    async log(event: string, data: Record<string, unknown> = {}) {
      await mkdir(out, { recursive: true });
      await appendFile(
        file,
        JSON.stringify({ at: new Date().toISOString(), ms: Date.now(), scenario, role, event, ...data }) + '\n',
      );
    },
    async signal(name: string, data: Record<string, unknown> = {}) {
      await mkdir(sync, { recursive: true });
      const tmp = join(sync, `.${name}.${process.pid}.tmp`);
      await writeFile(tmp, JSON.stringify({ ms: Date.now(), pid: process.pid, ...data }));
      await rename(tmp, join(sync, name));
    },
    async waitFor(name: string, timeoutMs = 90_000): Promise<Record<string, unknown>> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        try {
          return JSON.parse(await readFile(join(sync, name), 'utf8')) as Record<string, unknown>;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (Date.now() > deadline) throw new Error(`QA rendezvous timed out waiting for ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

export type TryReserve =
  | { ok: true; port: number; release: () => Promise<void>; ms: number; elapsedMs: number }
  | { ok: false; message: string; code?: string; ms: number; elapsedMs: number };

export async function tryReserve(start?: number, count?: number): Promise<TryReserve> {
  const began = Date.now();
  try {
    const r = await reserveApiPort(start, count);
    return { ok: true, port: r.port, release: r.release, ms: Date.now(), elapsedMs: Date.now() - began };
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    return { ok: false, message: e.message, code: e.code, ms: Date.now(), elapsedMs: Date.now() - began };
  }
}

export async function claimState(root: string, port: number) {
  try {
    return { exists: true, markers: await readdir(join(root, String(port))) };
  } catch (error) {
    return { exists: false, code: (error as NodeJS.ErrnoException).code };
  }
}
