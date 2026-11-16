import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_LOG_EXIT_FLUSH_MS,
  nodeLogFileSystem,
  openGatewayLog,
  type GatewayLogWriter,
  type LogFileSystem,
} from './gateway-log-writer.js';
import {
  ManagedExit,
  STARTUP_CAUSES,
  importFailureCause,
  productionDependencies,
  runManagedGateway,
  startupFailureRecord,
  takeLauncherLogDirectory,
  type ManagedApplication,
  type ManagedGatewayDependencies,
} from './guard.js';
import {
  LogRootRefusedError,
  logRootPipeName,
  reserveLogRoot,
  type LogRootReservation,
} from './managed-root.js';

const CANARY = 'GG_RAW_ERROR_CANARY C:\\private\\path GG_MASTER_KEY=secret';
/** Windows system tools by full path; Git Bash and other PATH entries can shadow them. */
const system = (tool: string) => join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', tool);
const roots: string[] = [];
const writers: GatewayLogWriter[] = [];
afterEach(async () => {
  for (const writer of writers.splice(0)) await writer.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), 'gg-guard-'));
  roots.push(root);
  return root;
}

/** A filesystem whose writes wait until released: the startup record cannot complete. */
function stalledFs(): { fs: LogFileSystem; release(): void } {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  return {
    release: () => release(),
    fs: {
      ...nodeLogFileSystem,
      async open(path, mode) {
        const handle = await nodeLogFileSystem.open(path, mode);
        return {
          ...handle,
          write: async (...args) => {
            await held;
            return handle.write(...args);
          },
        };
      },
    },
  };
}

function harness(root: string, overrides: Partial<ManagedGatewayDependencies> = {}) {
  const calls: string[] = [];
  const released = vi.fn(() => Promise.resolve());
  const deps: ManagedGatewayDependencies = {
    resolveRoot: (requested) => {
      calls.push(`resolve ${requested}`);
      return Promise.resolve({ path: root, dev: 1n, ino: 2n, pipeName: 'pipe' });
    },
    reserve: (pipeName) => {
      calls.push(`reserve ${pipeName}`);
      return Promise.resolve({ pipeName, release: released });
    },
    inspect: (path, names) => {
      calls.push(`inspect ${names.join(',')}`);
      return Promise.resolve(path);
    },
    openLog: async (options) => {
      calls.push('open');
      const writer = await openGatewayLog(options);
      writers.push(writer);
      return writer;
    },
    loadApplication: () => {
      calls.push('load');
      return Promise.reject(new Error('not configured'));
    },
    now: () => 1_700_000_000_000,
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...overrides,
  };
  return { deps, calls, released };
}

async function lines(root: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(join(root, 'gateway.log'), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('reserved launcher variable', () => {
  it('removes every spelling and returns the value, leaving other variables', () => {
    const env: NodeJS.ProcessEnv = {
      gg_windows_launcher_log_dir: 'C:\\first',
      GG_WINDOWS_LAUNCHER_LOG_DIR: 'C:\\second',
      GG_PORT: '4831',
    };
    expect(takeLauncherLogDirectory(env)).toBe('C:\\first');
    expect(env).toEqual({ GG_PORT: '4831' });
    expect(takeLauncherLogDirectory(env)).toBeUndefined();
  });
});

describe('managed admission outcomes', () => {
  it('maps a held reservation to 70 without touching any managed name', async () => {
    const root = await scratch();
    const { deps, calls } = harness(root, {
      reserve: () => Promise.reject(new LogRootRefusedError('in-use')),
    });
    expect(await runManagedGateway('C:\\requested', deps)).toBe(ManagedExit.destinationInUse);
    expect(calls).toEqual(['resolve C:\\requested']);
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    ['root', { resolveRoot: () => Promise.reject(new LogRootRefusedError('not-private')) }],
    ['bind', { reserve: () => Promise.reject(new LogRootRefusedError('reservation-failed')) }],
    ['metadata', { inspect: () => Promise.reject(new LogRootRefusedError('unsafe-entry')) }],
    ['slot', { openLog: () => Promise.reject(new Error('unsafe slot')) }],
  ] as const)(
    'maps an unsafe or unavailable %s to 71 and releases the reservation',
    async (_name, override) => {
      const root = await scratch();
      const { deps, calls, released } = harness(root, override);
      expect(await runManagedGateway('C:\\requested', deps)).toBe(
        ManagedExit.destinationUnavailable,
      );
      expect(calls).not.toContain('load');
      expect(released.mock.calls.length).toBe(
        calls.some((call) => call.startsWith('reserve')) ? 1 : 0,
      );
      expect(await readdir(root)).toEqual([]);
    },
  );

  it('inspects the exact managed names only while reserved, before opening the log', async () => {
    const root = await scratch();
    const { deps, calls } = harness(root);
    await runManagedGateway('C:\\requested', deps);
    expect(calls.slice(0, 4)).toEqual([
      'resolve C:\\requested',
      'reserve pipe',
      'inspect gateway.log,gateway.log.1',
      'open',
    ]);
  });
});

describe('guarded import and startup failures', () => {
  it('writes a closed import record and exits 72 once that record completed', async () => {
    const root = await scratch();
    const missing = Object.assign(new Error(`Cannot find package '${CANARY}'`), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    const { deps } = harness(root, { loadApplication: () => Promise.reject(missing) });
    expect(await runManagedGateway('C:\\requested', deps)).toBe(ManagedExit.importFailedWritten);
    const [record] = await lines(root);
    expect(record).toEqual({
      level: 50,
      time: 1_700_000_000_000,
      pid: process.pid,
      msg: 'GraphGoblin application import failed',
      stage: 'import',
      cause: 'module-not-found',
      detail: STARTUP_CAUSES['module-not-found'],
      guidance: expect.stringContaining('pnpm build'),
    });
    expect(await readFile(join(root, 'gateway.log'), 'utf8')).not.toContain('CANARY');
  });

  it('exits 73 when the import record cannot complete within 250 ms', async () => {
    const root = await scratch();
    const stalled = stalledFs();
    const { deps } = harness(root, {
      openLog: async (options) => {
        const writer = await openGatewayLog({ ...options, fs: stalled.fs });
        writers.push(writer);
        return writer;
      },
      loadApplication: () =>
        Promise.reject(Object.assign(new Error(CANARY), { code: 'ERR_DLOPEN_FAILED' })),
    });
    const started = performance.now();
    expect(await runManagedGateway('C:\\requested', deps)).toBe(ManagedExit.importFailedUnwritten);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(GATEWAY_LOG_EXIT_FLUSH_MS - 20);
    expect(elapsed).toBeLessThan(2_000);
    stalled.release();
  });

  function application(
    serve: ManagedApplication['serve'],
    cause: ManagedApplication['startupFailureCause'] = () => 'port-in-use',
  ): ManagedApplication {
    return { serve, startupFailureCause: cause };
  }

  it('writes a closed startup record at the reached stage and exits 74', async () => {
    const root = await scratch();
    const observed: unknown[] = [];
    const { deps } = harness(root, {
      loadApplication: () =>
        Promise.resolve(
          application(
            ({ managed }) => {
              managed.onStage('configuration');
              managed.destination.write('{"level":30,"msg":"private engine record"}\n');
              managed.onStage('store');
              managed.onStage('bind');
              return Promise.reject(Object.assign(new Error(CANARY), { code: 'EADDRINUSE' }));
            },
            (stage, error) => {
              observed.push(stage, error);
              return 'port-in-use';
            },
          ),
        ),
    });
    expect(await runManagedGateway('C:\\requested', deps)).toBe(ManagedExit.startupFailedWritten);
    expect(observed[0]).toBe('bind');
    const records = await lines(root);
    expect(records[0]).toEqual({ level: 30, msg: 'private engine record' });
    expect(records[1]).toMatchObject({
      msg: 'GraphGoblin startup failed',
      stage: 'bind',
      cause: 'port-in-use',
      detail: STARTUP_CAUSES['port-in-use'],
    });
    expect(JSON.stringify(records[1])).not.toContain('CANARY');
  });

  it('falls back to the unexpected cause and exits 75 when the record cannot complete', async () => {
    const root = await scratch();
    const stalled = stalledFs();
    const { deps } = harness(root, {
      openLog: async (options) => {
        const writer = await openGatewayLog({ ...options, fs: stalled.fs });
        writers.push(writer);
        return writer;
      },
      loadApplication: () =>
        Promise.resolve(
          application(
            () => Promise.reject(new Error(CANARY)),
            () => {
              throw new Error('classifier fault');
            },
          ),
        ),
    });
    expect(await runManagedGateway('C:\\requested', deps)).toBe(ManagedExit.startupFailedUnwritten);
    stalled.release();
    const writer = writers.at(-1)!;
    expect(await writer.settle(5_000)).toBe(true);
    const [record] = await lines(root);
    expect(record).toMatchObject({ stage: 'configuration', cause: 'unexpected' });
  });

  it('keeps the reservation and supplies the bounded destination once the gateway is listening', async () => {
    const root = await scratch();
    let supplied: Parameters<ManagedApplication['serve']>[0] | undefined;
    const { deps, released } = harness(root, {
      loadApplication: () =>
        Promise.resolve(
          application((options) => {
            supplied = options;
            return Promise.resolve({});
          }),
        ),
    });
    expect(await runManagedGateway('C:\\requested', deps)).toBeUndefined();
    expect(released).not.toHaveBeenCalled();
    expect(supplied?.managed.destination).toBe(writers.at(-1));
    supplied!.managed.destination.write('{"msg":"graceful exit"}\n');
    expect(await supplied!.managed.beforeExit()).toBe(true);
    expect(await lines(root)).toEqual([{ msg: 'graceful exit' }]);
  });

  it('classifies import failures by Node error code only', () => {
    expect(importFailureCause(Object.assign(new Error(), { code: 'MODULE_NOT_FOUND' }))).toBe(
      'module-not-found',
    );
    expect(importFailureCause(Object.assign(new Error(), { code: 'ERR_DLOPEN_FAILED' }))).toBe(
      'native-module-failed',
    );
    expect(importFailureCause(new SyntaxError(CANARY))).toBe('module-load-failed');
    expect(importFailureCause('not an error')).toBe('module-load-failed');
    for (const cause of Object.keys(STARTUP_CAUSES) as (keyof typeof STARTUP_CAUSES)[]) {
      const record = startupFailureRecord('store', cause, 1, 2);
      expect(Buffer.byteLength(record)).toBeLessThan(1024);
      expect(record.endsWith('}\n')).toBe(true);
    }
  });
});

describe('production guard dependencies on any platform', () => {
  it('wires the production root validation, reservation and writer', async () => {
    const load = vi.fn(() => Promise.reject(new Error('not loaded')));
    const deps = productionDependencies(load);
    await expect(deps.resolveRoot('relative\\path')).rejects.toBeInstanceOf(LogRootRefusedError);
    const pipeName =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\GraphGoblin.GatewayLog.test-${process.pid}-${Date.now()}`
        : join(tmpdir(), `gg-guard-${process.pid}-${Date.now()}.sock`);
    const reservation = await deps.reserve(pipeName);
    try {
      await expect(deps.reserve(pipeName)).rejects.toMatchObject({ reason: 'in-use' });
    } finally {
      await reservation.release();
    }
    const root = await scratch();
    const writer = await deps.openLog({ root });
    writers.push(writer);
    expect(writer.write('{"msg":"production"}\n')).toBe(true);
    expect(await writer.settle(5_000)).toBe(true);
    expect(await readFile(join(root, 'gateway.log'), 'utf8')).toBe('{"msg":"production"}\n');
    const before = deps.now();
    await deps.delay(5);
    expect(deps.now()).toBeGreaterThanOrEqual(before);
    await expect(deps.loadApplication()).rejects.toThrow('not loaded');
    expect(load).toHaveBeenCalledOnce();
  });
});

describe.skipIf(process.platform !== 'win32')('production guard dependencies on Windows', () => {
  // Production implementations; the wrapper only retains handles that process exit would release.
  const held: LogRootReservation[] = [];
  afterEach(async () => {
    for (const reservation of held.splice(0)) await reservation.release();
  });
  function production(load: () => Promise<ManagedApplication>): ManagedGatewayDependencies {
    const deps = productionDependencies(load);
    return {
      ...deps,
      reserve: async (name) => {
        const reservation = await deps.reserve(name);
        held.push(reservation);
        return reservation;
      },
      openLog: async (options) => {
        const writer = await deps.openLog(options);
        writers.push(writer);
        return writer;
      },
    };
  }

  /** Explicitly private: a profile can inherit access for other local principals. */
  async function privateScratch() {
    const root = await scratch();
    const execute = promisify(execFile);
    const { stdout } = await execute(system('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
    });
    const sid = /"(S-1-[0-9-]+)"/.exec(stdout)?.[1];
    expect(sid).toBeDefined();
    await execute(
      system('icacls.exe'),
      [
        root,
        '/inheritance:r',
        '/grant:r',
        `*${sid}:(OI)(CI)F`,
        '*S-1-5-18:(OI)(CI)F',
        '*S-1-5-32-544:(OI)(CI)F',
      ],
      { windowsHide: true },
    );
    return root;
  }

  it('admits a private root, writes the import record and refuses a same-root contender with 70', async () => {
    const root = await privateScratch();
    const failing = () =>
      Promise.reject(Object.assign(new Error(CANARY), { code: 'ERR_MODULE_NOT_FOUND' }));
    expect(await runManagedGateway(root, production(failing))).toBe(
      ManagedExit.importFailedWritten,
    );
    const [record] = await lines(root);
    expect(record).toMatchObject({ stage: 'import', cause: 'module-not-found' });
    expect((await readdir(root)).sort()).toEqual(['gateway.log']);
    const identity = await stat(root, { bigint: true });
    expect(held.map((reservation) => reservation.pipeName)).toEqual([
      logRootPipeName(identity.dev, identity.ino),
    ]);

    // The first owner still holds the reservation, as a live gateway would.
    const before = await readFile(join(root, 'gateway.log'));
    const loaded = vi.fn(failing);
    expect(await runManagedGateway(root, production(loaded))).toBe(ManagedExit.destinationInUse);
    expect(loaded).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'gateway.log'))).toEqual(before);
    await expect(reserveLogRoot(held[0]!.pipeName)).rejects.toBeInstanceOf(LogRootRefusedError);
  });

  it('refuses an invalid requested root with 71 before creating anything', async () => {
    const load = vi.fn(() => Promise.reject(new Error()));
    expect(await runManagedGateway('relative\\path', production(load))).toBe(
      ManagedExit.destinationUnavailable,
    );
    expect(load).not.toHaveBeenCalled();
    expect(held).toEqual([]);
  });
});
