import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GATEWAY_LOG_PIPE_PREFIX,
  LogRootRefusedError,
  MAX_LOG_ROOT_LENGTH,
  assertPrivateLogRoot,
  inspectLogRoot,
  logRootPipeName,
  metadataScript,
  parseMetadata,
  powerShellMetadata,
  reserveLogRoot,
  resolveLogRoot,
  trustedPrincipals,
  type LogRootMetadata,
  type LogRootReservation,
  type RootFileSystem,
} from './managed-root.js';

const USER = 'S-1-5-21-1-2-3-1001';
const NAMES = ['gateway.log', 'gateway.log.1'] as const;
/** Windows system tools by full path; Git Bash and other PATH entries can shadow them. */
const system = (tool: string) => join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', tool);
const roots: string[] = [];
const reservations: LogRootReservation[] = [];
afterEach(async () => {
  for (const reservation of reservations.splice(0)) await reservation.release();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

function metadata(overrides: Partial<LogRootMetadata> = {}): LogRootMetadata {
  return {
    user: USER,
    driveType: 'Fixed',
    driveFormat: 'NTFS',
    rootAttributes: 0x10,
    rootOwner: USER,
    rootNullDacl: false,
    rootRules: [
      { sid: 'S-1-5-18', allow: true },
      { sid: 'S-1-5-32-544', allow: true },
      { sid: USER, allow: true },
      { sid: 'S-1-1-0', allow: false },
    ],
    entries: { 'gateway.log': null, 'gateway.log.1': null },
    ...overrides,
  };
}
const privateEntry = {
  attributes: 0x20,
  owner: USER,
  nullDacl: false,
  rules: [{ sid: USER, allow: true }],
};
const refusal = (reason: string): unknown => expect.objectContaining({ reason }) as unknown;

describe('log root identity', () => {
  it('keys one pipe per volume and file identity at full width', () => {
    const name = logRootPipeName(2894493802n, 3659174705901373n);
    expect(name).toBe(logRootPipeName(2894493802n, 3659174705901373n));
    expect(name.startsWith(GATEWAY_LOG_PIPE_PREFIX)).toBe(true);
    expect(name).toMatch(/\.[0-9a-f]{40}$/);
    expect(logRootPipeName(2894493802n, 3659174705901374n)).not.toBe(name);
    expect(logRootPipeName(2894493803n, 3659174705901373n)).not.toBe(name);
    // Values above 2^53 differ only beyond double precision.
    expect(logRootPipeName(1n, 2n ** 60n + 1n)).not.toBe(logRootPipeName(1n, 2n ** 60n));
  });

  function fakeRoot(overrides: Partial<RootFileSystem> = {}): RootFileSystem {
    return {
      realpath: (path) => Promise.resolve(path.replace('alias', 'real')),
      stat: () => Promise.resolve({ dev: 7n, ino: 9n, isDirectory: () => true }),
      ...overrides,
    };
  }

  it('resolves aliases to a canonical local directory', async () => {
    await expect(resolveLogRoot('C:\\alias\\logs', fakeRoot())).resolves.toEqual({
      path: 'C:\\real\\logs',
      dev: 7n,
      ino: 9n,
      pipeName: logRootPipeName(7n, 9n),
    });
  });

  it.each([
    ['', 'invalid-path'],
    ['relative\\logs', 'invalid-path'],
    ['\\\\server\\share\\logs', 'invalid-path'],
    ['C:\\bad\u0007name', 'invalid-path'],
    ['C:\\' + 'x'.repeat(MAX_LOG_ROOT_LENGTH), 'invalid-path'],
  ])('refuses the requested path %j', async (requested, reason) => {
    await expect(resolveLogRoot(requested, fakeRoot())).rejects.toEqual(refusal(reason));
  });

  it('refuses unresolvable, nonlocal, nondirectory and identity-less roots', async () => {
    await expect(
      resolveLogRoot('C:\\x', fakeRoot({ realpath: () => Promise.reject(new Error('ENOENT')) })),
    ).rejects.toEqual(refusal('not-directory'));
    await expect(
      resolveLogRoot(
        'Z:\\mapped',
        fakeRoot({ realpath: () => Promise.resolve('\\\\host\\share') }),
      ),
    ).rejects.toEqual(refusal('not-local'));
    await expect(
      resolveLogRoot(
        'C:\\file',
        fakeRoot({ stat: () => Promise.resolve({ dev: 1n, ino: 2n, isDirectory: () => false }) }),
      ),
    ).rejects.toEqual(refusal('not-directory'));
    await expect(
      resolveLogRoot(
        'C:\\zero',
        fakeRoot({ stat: () => Promise.resolve({ dev: 1n, ino: 0n, isDirectory: () => true }) }),
      ),
    ).rejects.toEqual(refusal('no-identity'));
    // An alias retargeted between resolution and identity reads is not one physical root.
    await expect(
      resolveLogRoot(
        'C:\\alias\\moving',
        fakeRoot({
          stat: (path) =>
            Promise.resolve({
              dev: 7n,
              ino: path.includes('alias') ? 10n : 9n,
              isDirectory: () => true,
            }),
        }),
      ),
    ).rejects.toEqual(refusal('no-identity'));
  });
});

describe('log root reservation', () => {
  const pipe = () =>
    process.platform === 'win32'
      ? `${GATEWAY_LOG_PIPE_PREFIX}test-${randomUUID()}`
      : join(tmpdir(), `gg-log-root-${randomUUID()}.sock`);

  it('admits one holder, destroys clients without data and releases on close', async () => {
    const name = pipe();
    const owner = await reserveLogRoot(name);
    await expect(reserveLogRoot(name)).rejects.toEqual(refusal('in-use'));
    const received = await new Promise<{ bytes: number; closed: boolean }>((resolve) => {
      let bytes = 0;
      const client = createConnection(name);
      client.on('data', (chunk: Buffer) => (bytes += chunk.length));
      client.on('error', () => undefined);
      client.on('close', () => resolve({ bytes, closed: true }));
    });
    expect(received).toEqual({ bytes: 0, closed: true });
    await expect(reserveLogRoot(name)).rejects.toBeInstanceOf(LogRootRefusedError);
    await owner.release();
    const successor = await reserveLogRoot(name);
    reservations.push(successor);
    expect(successor.pipeName).toBe(name);
  });

  it('reports other bind failures as unavailable, not in use', async () => {
    const name =
      process.platform === 'win32'
        ? `${GATEWAY_LOG_PIPE_PREFIX}${'x'.repeat(300)}`
        : join(tmpdir(), randomUUID(), 'missing', 'root.sock');
    await expect(reserveLogRoot(name)).rejects.toEqual(refusal('reservation-failed'));
  });
});

describe('log root privacy metadata', () => {
  it('quotes managed paths as PowerShell literals', () => {
    const script = metadataScript("C:\\it's here", NAMES);
    expect(script).toContain("$root = 'C:\\it''s here'");
    expect(script).toContain("$names = @('gateway.log', 'gateway.log.1')");
    expect(script).not.toMatch(/Set-|Remove-|New-Item|Out-File/);
  });

  it('parses Windows PowerShell output, including single-element rule lists', () => {
    const parsed = parseMetadata(
      JSON.stringify({
        ...metadata(),
        rootRules: { sid: USER, allow: true },
        entries: {
          'gateway.log': { ...privateEntry, rules: privateEntry.rules[0] },
          'gateway.log.1': null,
        },
      }),
      NAMES,
    );
    expect(parsed.rootRules).toEqual([{ sid: USER, allow: true }]);
    expect(parsed.entries['gateway.log']).toEqual(privateEntry);
    expect(parsed.entries['gateway.log.1']).toBeNull();
    expect(
      parseMetadata(
        JSON.stringify({
          ...metadata(),
          rootRules: null,
          entries: { 'gateway.log': { attributes: 1024 }, 'gateway.log.1': null },
        }),
        NAMES,
      ),
    ).toMatchObject({ rootRules: [], entries: { 'gateway.log': { attributes: 1024 } } });
  });

  it.each([
    ['not json', 'not json'],
    ['missing user', JSON.stringify({ ...metadata(), user: undefined })],
    ['bad rule', JSON.stringify({ ...metadata(), rootRules: [{ sid: 1 }] })],
    ['no entries', JSON.stringify({ ...metadata(), entries: null })],
    [
      'bad entry',
      JSON.stringify({ ...metadata(), entries: { 'gateway.log': 'x', 'gateway.log.1': null } }),
    ],
    [
      'bad entry rules',
      JSON.stringify({
        ...metadata(),
        entries: { 'gateway.log': { attributes: 32, rules: [{}] }, 'gateway.log.1': null },
      }),
    ],
    ['null', 'null'],
  ])('treats %s as unverifiable', (_name, output) => {
    expect(() => parseMetadata(output, NAMES)).toThrow(LogRootRefusedError);
  });

  it('accepts a private NTFS root with private or absent managed names', () => {
    expect(() =>
      assertPrivateLogRoot(
        metadata({ entries: { 'gateway.log': privateEntry, 'gateway.log.1': null } }),
        NAMES,
      ),
    ).not.toThrow();
    expect(trustedPrincipals(USER).has('S-1-5-32-545')).toBe(false);
  });

  it.each<[string, Partial<LogRootMetadata>, string]>([
    ['a removable drive', { driveType: 'Removable' }, 'unsupported-filesystem'],
    ['a FAT volume', { driveFormat: 'exFAT' }, 'unsupported-filesystem'],
    ['a reparse-point root', { rootAttributes: 0x410 }, 'not-directory'],
    ['a foreign owner', { rootOwner: 'S-1-5-21-9-9-9-500' }, 'not-private'],
    ['a pseudo-principal owner', { rootOwner: 'S-1-3-0' }, 'not-private'],
    ['a null DACL', { rootNullDacl: true }, 'not-private'],
    ['Users read access', { rootRules: [{ sid: 'S-1-5-32-545', allow: true }] }, 'not-private'],
    [
      'a reparse-point name',
      { entries: { 'gateway.log': { ...privateEntry, attributes: 0x420 }, 'gateway.log.1': null } },
      'unsafe-entry',
    ],
    [
      'a directory name',
      { entries: { 'gateway.log': null, 'gateway.log.1': { attributes: 0x10 } } },
      'unsafe-entry',
    ],
    [
      'a foreign-owned name',
      {
        entries: {
          'gateway.log': { ...privateEntry, owner: 'S-1-5-21-9-9-9-500' },
          'gateway.log.1': null,
        },
      },
      'unsafe-entry',
    ],
    [
      'an unverifiable name',
      { entries: { 'gateway.log': { attributes: 0x20 }, 'gateway.log.1': null } },
      'unsafe-entry',
    ],
    [
      'a shared name',
      {
        entries: {
          'gateway.log': { ...privateEntry, rules: [{ sid: 'S-1-1-0', allow: true }] },
          'gateway.log.1': null,
        },
      },
      'unsafe-entry',
    ],
    ['a missing entry report', { entries: { 'gateway.log': null } }, 'metadata-unavailable'],
  ])('refuses %s', (_name, overrides, reason) => {
    expect(() => assertPrivateLogRoot(metadata(overrides), NAMES)).toThrow(
      expect.objectContaining({ reason }),
    );
  });

  it('refuses when the metadata query cannot run', async () => {
    await expect(
      inspectLogRoot('C:\\root', NAMES, () => Promise.reject(new Error('timeout'))),
    ).rejects.toEqual(refusal('metadata-unavailable'));
    await expect(
      inspectLogRoot('C:\\root', NAMES, () => Promise.resolve(JSON.stringify(metadata()))),
    ).resolves.toEqual(metadata());
  });
});

describe.skipIf(process.platform !== 'win32')('native Windows log root metadata', () => {
  const execute = promisify(execFile);
  /** Explicitly private: a profile can inherit access for other local principals. */
  async function privateRoot() {
    const root = await mkdtemp(join(tmpdir(), 'gg-log-root-'));
    roots.push(root);
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

  it('refuses a directory that inherits access for other principals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gg-log-root-'));
    roots.push(root);
    await execute(system('icacls.exe'), [root, '/grant', '*S-1-5-32-545:(OI)(CI)(M)'], {
      windowsHide: true,
    });
    await expect(inspectLogRoot(root, NAMES)).rejects.toEqual(refusal('not-private'));
  });

  it('resolves a junction alias to the same pipe key and admits a private profile directory', async () => {
    const root = await privateRoot();
    const physical = join(root, 'logs');
    await mkdir(physical);
    await symlink(physical, join(root, 'alias'), 'junction');
    const direct = await resolveLogRoot(physical);
    const aliased = await resolveLogRoot(join(root, 'alias'));
    expect(aliased).toEqual(direct);
    await writeFile(join(physical, 'gateway.log'), '{"msg":"kept"}\n');
    const observed = await inspectLogRoot(direct.path, NAMES);
    expect(observed.driveFormat).toBe('NTFS');
    expect(observed.entries['gateway.log']).toMatchObject({ attributes: expect.any(Number) });
    expect(observed.entries['gateway.log.1']).toBeNull();
  });

  it('refuses a junction, a directory and a shared ACL at the exact managed names', async () => {
    const root = await privateRoot();
    await mkdir(join(root, 'target'));
    await symlink(join(root, 'target'), join(root, 'gateway.log.1'), 'junction');
    await expect(inspectLogRoot(root, NAMES)).rejects.toEqual(refusal('unsafe-entry'));

    const directory = await privateRoot();
    await mkdir(join(directory, 'gateway.log'));
    await expect(inspectLogRoot(directory, NAMES)).rejects.toEqual(refusal('unsafe-entry'));

    const shared = await privateRoot();
    await writeFile(join(shared, 'gateway.log'), '');
    await execute(
      system('icacls.exe'),
      [join(shared, 'gateway.log'), '/grant', '*S-1-5-32-545:(R)'],
      {
        windowsHide: true,
      },
    );
    await expect(inspectLogRoot(shared, NAMES)).rejects.toEqual(refusal('unsafe-entry'));

    const sharedRoot = await privateRoot();
    await execute(system('icacls.exe'), [sharedRoot, '/grant', '*S-1-5-32-545:(OI)(CI)(R)'], {
      windowsHide: true,
    });
    await expect(inspectLogRoot(sharedRoot, NAMES)).rejects.toEqual(refusal('not-private'));
  });

  it('runs the real bounded PowerShell query', async () => {
    const root = await privateRoot();
    const parsed = parseMetadata(await powerShellMetadata(metadataScript(root, NAMES)), NAMES);
    expect(parsed.user).toMatch(/^S-1-5-21-/);
    expect(parsed.rootOwner).toMatch(/^S-1-/);
  });
});
