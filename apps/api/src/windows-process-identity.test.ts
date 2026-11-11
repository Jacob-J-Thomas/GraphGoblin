import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const execute = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: execute }),
}));
const originalProcess = process;
beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  vi.stubGlobal('process', {
    ...originalProcess,
    platform: 'win32',
    pid: 123,
    env: { SystemRoot: 'C:\\Windows' },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('reads the OS creation time with a bounded hidden, profile-free query', async () => {
  execute.mockResolvedValue({ stdout: '134388256826197750\r\n' });
  const { windowsProcessIdentity } = await import('./windows-process-identity.js');
  expect(await windowsProcessIdentity(987)).toEqual({ identity: '134388256826197750' });
  expect(execute).toHaveBeenCalledWith(
    expect.stringMatching(/System32[/\\]WindowsPowerShell[/\\]v1.0[/\\]powershell.exe$/),
    ['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('ProcessId = 987')],
    { windowsHide: true, timeout: 5000, maxBuffer: 1024 },
  );
});

it.each(['', 'garbage', '0', '134388256826197750\n134388256826197750'])(
  'does not treat invalid or missing probe output %j as an identity',
  async (stdout) => {
    execute.mockResolvedValue({ stdout });
    const { windowsProcessIdentity } = await import('./windows-process-identity.js');
    expect(await windowsProcessIdentity(987)).toHaveProperty('reason');
  },
);

it('keeps probe failure unknown and retries a failed self lookup', async () => {
  execute.mockRejectedValue(Object.assign(new Error('timeout'), { killed: true }));
  const { ownWindowsProcessIdentity } = await import('./windows-process-identity.js');
  await expect(ownWindowsProcessIdentity()).rejects.toThrow(
    'Cannot establish Windows process identity',
  );
  execute.mockResolvedValue({ stdout: '134388256826197750' });
  expect(await ownWindowsProcessIdentity()).toBe('134388256826197750');
  expect(await ownWindowsProcessIdentity()).toBe('134388256826197750');
  expect(execute).toHaveBeenCalledTimes(3);
});

it('does not cache another process identity across PID reuse', async () => {
  execute
    .mockResolvedValueOnce({ stdout: '134388256826197750' })
    .mockResolvedValueOnce({ stdout: '134388256826197760' });
  const { windowsProcessIdentity } = await import('./windows-process-identity.js');
  expect(await windowsProcessIdentity(987)).toEqual({ identity: '134388256826197750' });
  expect(await windowsProcessIdentity(987)).toEqual({ identity: '134388256826197760' });
});

it('does not interpolate invalid PIDs and does not query on other operating systems', async () => {
  const { windowsProcessIdentity, ownWindowsProcessIdentity } =
    await import('./windows-process-identity.js');
  for (const pid of [0, -1, 1.5, NaN])
    expect(await windowsProcessIdentity(pid)).toHaveProperty('reason');
  vi.stubGlobal('process', { ...originalProcess, platform: 'linux' });
  expect(await windowsProcessIdentity(987)).toHaveProperty('reason');
  expect(await ownWindowsProcessIdentity()).toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
});

it('uses the Windows default system directory when SystemRoot is absent', async () => {
  vi.stubGlobal('process', { ...originalProcess, platform: 'win32', env: {} });
  execute.mockResolvedValue({ stdout: '134388256826197750' });
  const { windowsProcessIdentity } = await import('./windows-process-identity.js');
  expect(await windowsProcessIdentity(987)).toEqual({ identity: '134388256826197750' });
  expect(execute.mock.calls[0]?.[0]).toMatch(/^C:\\Windows/);
});

it('retries a timed-out self query within the startup budget and caches success', async () => {
  execute
    .mockRejectedValueOnce(Object.assign(new Error('timeout'), { killed: true }))
    .mockResolvedValueOnce({ stdout: '134388256826197750' });
  const { ownWindowsProcessIdentity } = await import('./windows-process-identity.js');
  expect(await ownWindowsProcessIdentity()).toBe('134388256826197750');
  expect(await ownWindowsProcessIdentity()).toBe('134388256826197750');
  expect(execute).toHaveBeenCalledTimes(2);
  for (const call of execute.mock.calls) expect(call[2]).toMatchObject({ timeout: 20_000 });
});

it.each([
  [Object.assign(new Error('slow'), { killed: true }), 'timed out'],
  [Object.assign(new Error('missing'), { code: 'ENOENT' }), 'could not start'],
  [new Error('WMI failure'), 'Instrumentation'],
])('retains the reason for a failed foreign process probe', async (error, reason) => {
  execute.mockRejectedValue(error);
  const { windowsProcessIdentity } = await import('./windows-process-identity.js');
  expect((await windowsProcessIdentity(987)).reason).toContain(reason);
});
