// Disposable independent-QA helper for #407 correction 01. Not candidate code; removed after the QA session.
import { spawn } from 'node:child_process';
import { appendFile, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { reserveApiPort } from '../testing/api-port.js';

export const EXHAUSTED = 'No disposable API port is available in ';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const hr = () => process.hrtime.bigint();
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function qaEnv() {
  const sync = process.env.QA407C_SYNC;
  const out = process.env.QA407C_OUT;
  const scripts = process.env.QA407C_SCRIPTS;
  if (!sync || !out || !scripts) throw new Error('QA407C_SYNC, QA407C_OUT and QA407C_SCRIPTS are required');
  for (const p of [sync, out, scripts])
    if (!p.includes('i1-ports-407-correction-independent-claude-qa'))
      throw new Error(`Refusing unexpected QA path ${p}`);
  return { sync, out, scripts };
}

export function logger(scenario: string, role: string) {
  const file = join(qaEnv().out, `${scenario}-${role}.jsonl`);
  return async (event: string, data: Record<string, unknown> = {}) => {
    const row = { at: new Date().toISOString(), hr: String(hr()), pid: process.pid, scenario, role, event, ...data };
    await appendFile(file, JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? String(v) : v)) + '\n');
  };
}

export async function writeJson(name: string, value: unknown) {
  await writeFile(
    join(qaEnv().out, name),
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 1),
  );
}

export async function signal(name: string, data: Record<string, unknown> = {}) {
  const { sync } = qaEnv();
  const tmp = join(sync, `.${name}.${process.pid}.tmp`);
  await writeFile(
    tmp,
    JSON.stringify({ ms: Date.now(), hr: String(hr()), pid: process.pid, ...data }, (_k, v) =>
      typeof v === 'bigint' ? String(v) : v,
    ),
  );
  await rename(tmp, join(sync, name));
}

export async function abort(role: string, error: unknown) {
  await signal(`ABORT-${role}`, { message: String((error as Error)?.message ?? error) }).catch(() => undefined);
}

export async function waitFor(name: string, other: string, timeoutMs = 90_000): Promise<Record<string, unknown>> {
  const { sync } = qaEnv();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return JSON.parse(await readFile(join(sync, name), 'utf8')) as Record<string, unknown>;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
    }
    try {
      const reason = await readFile(join(sync, `ABORT-${other}`), 'utf8');
      throw new Error(`peer ${other} aborted while waiting for ${name}: ${reason}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (Date.now() > deadline) throw new Error(`QA rendezvous timed out waiting for ${name}`);
    await sleep(5);
  }
}

export type Attempt =
  | { ok: true; port: number; release: () => Promise<void>; t0: bigint; t1: bigint }
  | { ok: false; exhausted: boolean; code?: string; message: string; t0: bigint; t1: bigint };

export async function tryReserve(start: number, count: number): Promise<Attempt> {
  const t0 = hr();
  try {
    const r = await reserveApiPort(start, count);
    return { ok: true, port: r.port, release: r.release, t0, t1: hr() };
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    const exhausted = e.message.startsWith(`${EXHAUSTED}${start}-${start + count - 1}.`);
    return { ok: false, exhausted, code: e.code, message: e.message, t0, t1: hr() };
  }
}

export const brief = (a: Attempt) =>
  a.ok
    ? { ok: true, port: a.port, t0: String(a.t0), t1: String(a.t1) }
    : { ok: false, exhausted: a.exhausted, code: a.code, message: a.message, t0: String(a.t0), t1: String(a.t1) };

export async function slotState(root: string, port: number) {
  const slot = join(root, String(port));
  let names: string[];
  try {
    names = await readdir(slot);
  } catch (error) {
    return { exists: false, code: (error as NodeJS.ErrnoException).code, gens: [] as number[], other: [] as string[], entries: {} as Record<string, string[]> };
  }
  const gens = names.map(Number).filter((n) => Number.isSafeInteger(n)).sort((a, b) => a - b);
  const other = names.filter((n) => !Number.isSafeInteger(Number(n)));
  const entries: Record<string, string[]> = {};
  for (const g of gens) entries[String(g)] = (await readdir(join(slot, String(g)))).sort();
  return { exists: true, code: undefined as string | undefined, gens, other, entries };
}

export async function newest(slot: string) {
  let latest = 0;
  for (const name of await readdir(slot)) {
    const g = Number(name);
    if (Number.isSafeInteger(g)) latest = Math.max(latest, g);
  }
  return { latest, entries: await readdir(join(slot, String(latest))) };
}

export function bindProbe(port: number, host: string, ipv6Only = false): Promise<string> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
    s.listen({ port, host, ipv6Only }, () => s.close(() => resolve('ok')));
  });
}

export function httpGet(
  host: string,
  port: number,
  path = '/',
): Promise<{ status?: number; body?: string; error?: string }> {
  return new Promise((resolve) => {
    const req = request(
      { host, port, path, method: 'GET', agent: false, timeout: 3000, headers: { connection: 'close' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 200) }));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'QA_TIMEOUT' })));
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ error: e.code ?? e.message }));
    req.end();
  });
}

export function alive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startForeign(port: number, mode: string, label: string) {
  const { sync, scripts } = qaEnv();
  const ready = join(sync, `foreign-${label}-${port}.json`);
  const child = spawn(process.execPath, [join(scripts, 'foreign-listener.mjs'), String(port), mode, ready], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (output += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (output += d));
  let exitCode: number | null | undefined;
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', (code) => {
      exitCode = code;
      resolve(code);
    }),
  );
  const handle = {
    port,
    mode,
    pid: child.pid,
    info: undefined as unknown,
    output: () => output,
    running: () => exitCode === undefined,
    async stop() {
      if (exitCode !== undefined) return { exitCode, forced: false };
      child.stdin.end();
      const result = await Promise.race([exited, sleep(5000).then(() => 'timeout' as const)]);
      if (result === 'timeout') {
        child.kill('SIGKILL');
        await exited;
        return { exitCode, forced: true };
      }
      return { exitCode, forced: false };
    },
  };
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      handle.info = JSON.parse(await readFile(ready, 'utf8'));
      return handle;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
    }
    if (exitCode !== undefined) throw new Error(`foreign ${mode}:${port} exited ${exitCode}: ${output}`);
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`foreign ${mode}:${port} not ready: ${output}`);
    }
    await sleep(10);
  }
}
