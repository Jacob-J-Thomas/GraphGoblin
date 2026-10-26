import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProcessScripts, killTree } from './scripts.js';

const node = process.execPath;

function request(overrides: Partial<Parameters<ProcessScripts['run']>[0]>) {
  return {
    command: node,
    args: [],
    cwd: process.cwd(),
    env: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('ProcessScripts', () => {
  function observeChunks(maxOutputBytes: number | undefined, offset: number) {
    const sizes: Record<'stdout' | 'stderr', number[]> = { stdout: [], stderr: [] };
    const scripts = new ProcessScripts({
      ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
      spawnImpl: new Proxy(spawn, {
        apply(target, _receiver, args: Parameters<typeof spawn>) {
          const child = target(args[0], args[1], {
            ...args[2],
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          });
          let acknowledged = false;
          for (const [name, stream] of [
            ['stdout', child.stdout],
            ['stderr', child.stderr],
          ] as const)
            stream?.on('data', (chunk: Buffer) => {
              sizes[name].push(chunk.byteLength);
              if (
                offset > 0 &&
                !acknowledged &&
                sizes.stdout.length > 0 &&
                sizes.stderr.length > 0
              ) {
                acknowledged = true;
                child.send?.('continue');
              }
            });
          return child;
        },
      }),
    });
    return { scripts, sizes };
  }

  it('returns raw captured byte counts and truncation for default capture, including incomplete EOF', async () => {
    const result = await new ProcessScripts({ maxOutputBytes: 4 }).run(
      request({
        args: [
          '-e',
          'process.stdout.write(Buffer.from([240,159,166,142,120]));process.stderr.write(Buffer.from([240,159]));',
        ],
      }),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: '\u{1f98e}',
      stdoutBytes: 4,
      stdoutOverflow: true,
      stderr: '\ufffd',
      stderrBytes: 2,
      stderrOverflow: false,
    });
  });
  const unicode = 'A\u00e9\u96ea\u{1f98e}Z';
  const bytes = Buffer.from(unicode);
  const splitScript = (offset: number, suffix = ''): string => `
    const bytes = Buffer.from(${JSON.stringify([...bytes])});
    const finish = () => {
      for (const stream of [process.stdout, process.stderr]) {
        stream.write(bytes.subarray(${offset}));
        ${suffix}
      }
      process.disconnect();
    };
    if (${offset} > 0) {
      process.once('message', finish);
      for (const stream of [process.stdout, process.stderr]) stream.write(bytes.subarray(0, ${offset}));
    } else finish();
  `;

  it.each(Array.from({ length: bytes.length + 1 }, (_, offset) => offset))(
    'preserves both UTF-8 streams split at byte offset %i with default and explicit bounds',
    async (offset) => {
      for (const limits of [{}, { maxStdoutBytes: bytes.length, maxStderrBytes: bytes.length }]) {
        const { scripts, sizes } = observeChunks(undefined, offset);
        const result = await scripts.run(request({ args: ['-e', splitScript(offset)], ...limits }));
        expect(result).toMatchObject({ stdout: unicode, stderr: unicode, exitCode: 0 });
        expect(result).toMatchObject({
          stdoutBytes: bytes.length,
          stderrBytes: bytes.length,
          stdoutOverflow: false,
          stderrOverflow: false,
        });
        for (const stream of ['stdout', 'stderr'] as const) {
          expect(sizes[stream][0]).toBe(offset === 0 ? bytes.length : offset);
          expect(sizes[stream].length).toBeGreaterThanOrEqual(
            offset > 0 && offset < bytes.length ? 2 : 1,
          );
        }
      }
    },
  );

  it.each(Array.from({ length: bytes.length + 1 }, (_, cap) => cap))(
    'counts raw bytes and drops only a cap-split suffix at cap %i on both streams',
    async (cap) => {
      const prefix = new TextDecoder().decode(bytes.subarray(0, cap));
      const text = prefix.endsWith('\ufffd') ? prefix.slice(0, -1) : prefix;
      for (const limits of [{}, { maxStdoutBytes: cap, maxStderrBytes: cap }]) {
        const { scripts, sizes } = observeChunks(cap, 4);
        const result = await scripts.run(
          request({ args: ['-e', splitScript(4, 'stream.write("!");')], ...limits }),
        );
        expect(result).toMatchObject({ stdout: text, stderr: text, exitCode: 0 });
        expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(cap);
        expect(result).toMatchObject({
          stdoutBytes: cap,
          stderrBytes: cap,
          stdoutOverflow: true,
          stderrOverflow: true,
        });
        for (const stream of ['stdout', 'stderr'] as const) {
          expect(sizes[stream][0]).toBe(4);
          expect(sizes[stream].length).toBeGreaterThanOrEqual(2);
        }
      }
    },
  );

  it('replaces an incomplete trailing sequence at clean EOF on both streams', async () => {
    for (const limits of [{}, { maxStdoutBytes: 3, maxStderrBytes: 3 }]) {
      const result = await new ProcessScripts().run(
        request({
          args: [
            '-e',
            'process.stdout.write(Buffer.from([65,240,159]));process.stderr.write(Buffer.from([66,226,130]));',
          ],
          ...limits,
        }),
      );
      expect(result).toMatchObject({ stdout: 'A\ufffd', stderr: 'B\ufffd', exitCode: 0 });
    }
  });

  it('kills and closes a real process cancelled with incomplete UTF-8 pending on both streams', async () => {
    const controller = new AbortController();
    let pid: number | undefined;
    let streamsReady = 0;
    let ownedChild: ChildProcess | undefined;
    const scripts = new ProcessScripts({
      spawnImpl: new Proxy(spawn, {
        apply(target, _receiver, args: Parameters<typeof spawn>) {
          const child = target(...args);
          if (args[0] === node) {
            ownedChild = child;
            pid = child.pid;
            for (const stream of [child.stdout, child.stderr])
              stream?.once('data', () => {
                if (++streamsReady === 2) setImmediate(() => controller.abort());
              });
          }
          return child;
        },
      }),
    });
    let cleanupRequired = false;
    const cleanup = setTimeout(() => {
      cleanupRequired = true;
      ownedChild?.kill();
    }, 8000);
    const result = await scripts
      .run(
        request({
          args: [
            '-e',
            'process.stdout.write(Buffer.from([65,240,159]));process.stderr.write(Buffer.from([66,226,130]));setInterval(()=>{},1000);',
          ],
          signal: controller.signal,
        }),
      )
      .finally(() => clearTimeout(cleanup));
    expect(
      cleanupRequired,
      'native process-tree cancellation must finish before fixture cleanup',
    ).toBe(false);
    expect(streamsReady).toBe(2);
    expect(result).toMatchObject({ stdout: 'A\ufffd', stderr: 'B\ufffd', timedOut: false });
    expect(result.exitCode).not.toBe(0);
    if (pid === undefined) throw new Error('child did not start');
    const childPid = pid;
    expect(() => process.kill(childPid, 0)).toThrow();
  });

  it('captures stdout, stderr, exit code, env, args, and stdin', async () => {
    const scripts = new ProcessScripts({ baseEnv: { PATH: process.env['PATH'] ?? '' } });
    const result = await scripts.run(
      request({
        args: [
          '-e',
          'let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",()=>{process.stdout.write(JSON.stringify({args:process.argv.slice(1),env:process.env.GG_TEST,input}));process.stderr.write("warn");process.exit(3)})',
          'a',
          'b',
        ],
        env: { GG_TEST: 'yes' },
        stdin: 'hello',
      }),
    );
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe('warn');
    expect(JSON.parse(result.stdout)).toEqual({ args: ['a', 'b'], env: 'yes', input: 'hello' });
  });

  it('closes stdin when none is provided', async () => {
    const scripts = new ProcessScripts();
    const result = await scripts.run(
      request({
        args: [
          '-e',
          'let n=0;process.stdin.on("data",()=>n++);process.stdin.on("end",()=>{process.stdout.write(String(n))})',
        ],
      }),
    );
    expect(result.stdout).toBe('0');
    expect(result.exitCode).toBe(0);
  });

  it('kills the process tree on timeout', async () => {
    const scripts = new ProcessScripts();
    const started = Date.now();
    const result = await scripts.run(
      request({ args: ['-e', 'setTimeout(()=>{}, 20000)'], timeoutMs: 300 }),
    );
    expect(result.timedOut).toBe(true);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);

  it('kills the process when the signal aborts, including when already aborted', async () => {
    const scripts = new ProcessScripts();
    const controller = new AbortController();
    const pending = scripts.run(
      request({ args: ['-e', 'setTimeout(()=>{}, 20000)'], signal: controller.signal }),
    );
    setTimeout(() => controller.abort(), 100);
    const result = await pending;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);

    const aborted = new AbortController();
    aborted.abort();
    const immediate = await scripts.run(
      request({ args: ['-e', 'setTimeout(()=>{}, 20000)'], signal: aborted.signal }),
    );
    expect(immediate.exitCode === null || immediate.exitCode !== 0).toBe(true);
    expect(immediate.state).toBe('definitely-not-started');
  }, 15_000);

  it('reports spawn failures as a null exit code with a message', async () => {
    const scripts = new ProcessScripts();
    const result = await scripts.run(
      request({ command: 'definitely-not-a-real-command-gg', args: [] }),
    );
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toMatch(/spawn failed/);
    expect(result.state).toBe('definitely-not-started');
  });

  it('classifies a synchronous EINVAL refusal without leaking its command', async () => {
    const scripts = new ProcessScripts({
      spawnImpl: new Proxy(spawn, {
        apply() {
          throw Object.assign(new Error('sensitive command'), { code: 'EINVAL' });
        },
      }),
    });
    const result = await scripts.run(request({ command: 'sensitive.cmd' }));
    expect(result).toMatchObject({
      state: 'definitely-not-started',
      exitCode: null,
      stderr: 'spawn failed: PROCESS_START_FAILED',
    });
    expect(result.stderr).not.toContain('sensitive');
    expect((await scripts.run(request({ maxStderrBytes: 0 }))).stderr).toBe('');
  });

  it.skipIf(process.platform !== 'win32')(
    'proves the native .cmd EINVAL refusal never executes its marker',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'gg-wp-d1-spawn-'));
      try {
        const command = join(dir, 'refused.cmd');
        const marker = join(dir, 'marker');
        await writeFile(command, `@echo effect>"${marker}"\r\n`);
        const result = await new ProcessScripts().run(request({ command, args: [], cwd: dir }));
        expect(result).toMatchObject({ state: 'definitely-not-started', exitCode: null });
        await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      await expect(access(dir)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('caps captured output', async () => {
    const scripts = new ProcessScripts({ maxOutputBytes: 100 });
    const result = await scripts.run(
      request({ args: ['-e', 'process.stdout.write("x".repeat(10000))'] }),
    );
    expect(result.stdout).toHaveLength(100);
    expect(result.exitCode).toBe(0);
  });

  it('bounds opted-in stdout by raw bytes and reports overflow without changing legacy capture', async () => {
    const scripts = new ProcessScripts();
    const args = ['-e', 'process.stdout.write("é".repeat(32769))'];
    const bounded = await scripts.run(request({ args, maxStdoutBytes: 65_536 }));
    expect(bounded.exitCode).toBe(0);
    expect(bounded.stdoutOverflow).toBe(true);
    expect(Buffer.byteLength(bounded.stdout)).toBe(65_536);
    expect(bounded.stdout).toBe('é'.repeat(32768));
    const legacy = await scripts.run(request({ args }));
    expect(legacy.stdoutOverflow).toBe(false);
    expect(legacy.stdout).toBe('é'.repeat(32769));
  });

  it('reports exact-cap output as complete and does not emit a cap-split UTF8 suffix', async () => {
    const scripts = new ProcessScripts();
    const complete = await scripts.run(
      request({ args: ['-e', 'process.stdout.write("abc")'], maxStdoutBytes: 3 }),
    );
    expect(complete).toMatchObject({ stdout: 'abc', stdoutOverflow: false, exitCode: 0 });
    const split = await scripts.run(
      request({ args: ['-e', 'process.stdout.write("é")'], maxStdoutBytes: 1 }),
    );
    expect(split).toMatchObject({ stdout: '', stdoutOverflow: true, exitCode: 0 });
    expect(() => scripts.run(request({ maxStdoutBytes: -1 }))).toThrow(RangeError);
  });

  it('uses fixed spawn diagnostics without echoing a credential-bearing command', async () => {
    const scripts = new ProcessScripts();
    const result = await scripts.run(request({ command: 'missing-command-with-secret-token-gg' }));
    expect(result.stderr).toBe('spawn failed: PROCESS_START_FAILED');
    expect(result.stderr).not.toContain('secret-token');
  });
});

describe('killTree', () => {
  function fakeChild(pid: number | undefined): ChildProcess & { killed_: boolean } {
    const child = new EventEmitter() as ChildProcess & { killed_: boolean };
    Object.assign(child, { pid, killed_: false, kill: () => ((child.killed_ = true), true) });
    return child;
  }

  it('does nothing without a pid', async () => {
    const child = fakeChild(undefined);
    expect(await killTree(child, 'win32')).toBe(true);
    expect(child.killed_).toBe(false);
  });

  it('uses taskkill on Windows and reports root-only fallback when taskkill is missing', async () => {
    const calls: unknown[][] = [];
    const killer = new EventEmitter();
    const spawnImpl = ((...args: unknown[]) => {
      calls.push(args);
      return killer;
    }) as unknown as typeof spawn;
    const child = fakeChild(1234);
    const pending = killTree(child, 'win32', spawnImpl);
    expect(calls[0]?.[0]).toBe('taskkill');
    expect(calls[0]?.[1]).toEqual(['/pid', '1234', '/T', '/F']);
    killer.emit('error', new Error('no taskkill'));
    expect(await pending).toBe(false);
    expect(child.killed_).toBe(true);
  });

  it('signals the process group on POSIX and reports root-only fallback on failure', async () => {
    const child = fakeChild(999_999_999);
    expect(await killTree(child, 'linux')).toBe(false);
    expect(child.killed_).toBe(true);
  });
});
