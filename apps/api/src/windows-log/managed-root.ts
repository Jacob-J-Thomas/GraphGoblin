/**
 * Private physical log root for the Windows launcher's detached gateway (#438, ADR-0081).
 * Node built-ins only: the guarded entry runs this before any dependency or store import.
 *
 * The requested directory resolves through aliases to one canonical local NTFS directory. Its
 * volume serial and file index, at full observed width, key a Node core named-pipe reservation
 * that the gateway holds until its managed log I/O ends. Windows security metadata establishes
 * that the root and the exact managed names are private to the operator and trusted principals.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';

/** Windows-only internal launcher input. Never configuration, identity or provider input. */
export const LAUNCHER_LOG_DIR_VARIABLE = 'GG_WINDOWS_LAUNCHER_LOG_DIR';
export const GATEWAY_LOG_PIPE_PREFIX = '\\\\.\\pipe\\GraphGoblin.GatewayLog.';
/** Longest accepted log-root path, in UTF-16 code units. */
export const MAX_LOG_ROOT_LENGTH = 1024;

const SYSTEM = 'S-1-5-18';
const ADMINISTRATORS = 'S-1-5-32-544';
const TRUSTED_INSTALLER = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const CREATOR_OWNER = 'S-1-3-0';
const OWNER_RIGHTS = 'S-1-3-4';
const REPARSE_POINT = 0x400;
const DIRECTORY = 0x10;
const DEVICE = 0x40;

/** Why managed admission was refused. `in-use` maps to launcher outcome 70, the rest to 71. */
export type LogRootRefusal =
  | 'in-use'
  | 'invalid-path'
  | 'not-local'
  | 'not-directory'
  | 'no-identity'
  | 'metadata-unavailable'
  | 'unsupported-filesystem'
  | 'not-private'
  | 'unsafe-entry'
  | 'reservation-failed';

export class LogRootRefusedError extends Error {
  constructor(readonly reason: LogRootRefusal) {
    super(`managed gateway log root refused (${reason})`);
    this.name = 'LogRootRefusedError';
  }
}

export interface AdmittedLogRoot {
  /** Canonical physical path, after resolving every alias. */
  path: string;
  dev: bigint;
  ino: bigint;
  pipeName: string;
}

/** C0 and C1 control characters, which a path field never displays. */
function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Pipe name from the stable volume/file identity; aliases of one directory share it. */
export function logRootPipeName(dev: bigint, ino: bigint): string {
  const digest = createHash('sha256')
    .update(`graphgoblin-gateway-log-root/v1\0dev=${dev}\0ino=${ino}`)
    .digest('hex');
  return GATEWAY_LOG_PIPE_PREFIX + digest.slice(0, 40);
}

export interface RootFileSystem {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ dev: bigint; ino: bigint; isDirectory(): boolean }>;
}

const nodeRootFileSystem: RootFileSystem = {
  realpath: (path) => realpath(path),
  stat: (path) => stat(path, { bigint: true }),
};

/** Resolve the launcher's requested directory to its canonical local physical identity. */
export async function resolveLogRoot(
  requested: string,
  fs: RootFileSystem = nodeRootFileSystem,
): Promise<AdmittedLogRoot> {
  if (
    requested.length === 0 ||
    requested.length > MAX_LOG_ROOT_LENGTH ||
    hasControl(requested) ||
    !/^[A-Za-z]:[\\/]/.test(requested)
  )
    throw new LogRootRefusedError('invalid-path');
  let path: string;
  let info: Awaited<ReturnType<RootFileSystem['stat']>>;
  let requestedInfo: Awaited<ReturnType<RootFileSystem['stat']>>;
  try {
    path = await fs.realpath(requested);
    info = await fs.stat(path);
    requestedInfo = await fs.stat(requested);
  } catch {
    throw new LogRootRefusedError('not-directory');
  }
  // Mapped network drives and volume GUID paths resolve away from a local drive letter.
  if (!/^[A-Za-z]:\\/.test(path) || path.length > MAX_LOG_ROOT_LENGTH || hasControl(path))
    throw new LogRootRefusedError('not-local');
  if (!info.isDirectory()) throw new LogRootRefusedError('not-directory');
  // The requested spelling and its canonical path must be one stable physical directory.
  if (info.ino === 0n || requestedInfo.dev !== info.dev || requestedInfo.ino !== info.ino)
    throw new LogRootRefusedError('no-identity');
  return { path, dev: info.dev, ino: info.ino, pipeName: logRootPipeName(info.dev, info.ino) };
}

/** A held reservation. It carries no data and accepts no commands. */
export interface LogRootReservation {
  readonly pipeName: string;
  release(): Promise<void>;
}

/**
 * Reserve the root through a first-instance named pipe. A bind conflict means the reservation
 * is unavailable; it neither grants authority to log nor proves which gateway holds it.
 */
export function reserveLogRoot(pipeName: string): Promise<LogRootReservation> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer({ pauseOnConnect: true }, (socket) => socket.destroy());
    const refuse = (error: NodeJS.ErrnoException) => {
      server.close();
      reject(
        new LogRootRefusedError(error.code === 'EADDRINUSE' ? 'in-use' : 'reservation-failed'),
      );
    };
    server.once('error', refuse);
    server.listen(pipeName, () => {
      server.off('error', refuse);
      // A later server error leaves the held instance to process exit; never crash the gateway.
      server.on('error', () => undefined);
      // Ownership lasts until release or process exit; it never keeps the process alive.
      server.unref();
      resolve({
        pipeName,
        release: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

/** One access-control entry as reported by Windows. */
export interface AccessRule {
  sid: string;
  allow: boolean;
}

export interface EntryMetadata {
  attributes: number;
  owner?: string;
  nullDacl?: boolean;
  rules?: AccessRule[];
}

/** Windows security and file metadata that Node cannot read. */
export interface LogRootMetadata {
  user: string;
  driveType: string;
  driveFormat: string;
  rootAttributes: number;
  rootOwner: string;
  rootNullDacl: boolean;
  rootRules: AccessRule[];
  entries: Record<string, EntryMetadata | null>;
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** The bounded system PowerShell query. Paths are validated literals; nothing is modified. */
export function metadataScript(root: string, names: readonly string[]): string {
  return `$ErrorActionPreference = 'Stop'
$root = ${quote(root)}
$names = @(${names.map(quote).join(', ')})
function Rules($security) {
  @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
    [pscustomobject]@{ sid = $_.IdentityReference.Value; allow = ($_.AccessControlType -eq 'Allow') }
  })
}
function NullDacl($security) { $security.GetSecurityDescriptorSddlForm('Access') -match 'NO_ACCESS_CONTROL' }
$drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($root))
$rootSecurity = [IO.Directory]::GetAccessControl($root)
$entries = [ordered]@{}
foreach ($name in $names) {
  $path = [IO.Path]::Combine($root, $name)
  try { $attributes = [IO.File]::GetAttributes($path) }
  catch [IO.FileNotFoundException] { $entries[$name] = $null; continue }
  catch [IO.DirectoryNotFoundException] { $entries[$name] = $null; continue }
  $entry = [ordered]@{ attributes = [int]$attributes }
  if (($attributes -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::Device)) -eq 0) {
    $security = [IO.File]::GetAccessControl($path)
    $entry.owner = $security.GetOwner([Security.Principal.SecurityIdentifier]).Value
    $entry.nullDacl = [bool](NullDacl $security)
    $entry.rules = Rules $security
  }
  $entries[$name] = $entry
}
[ordered]@{
  user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  driveType = [string]$drive.DriveType
  driveFormat = [string]$drive.DriveFormat
  rootAttributes = [int][IO.File]::GetAttributes($root)
  rootOwner = $rootSecurity.GetOwner([Security.Principal.SecurityIdentifier]).Value
  rootNullDacl = [bool](NullDacl $rootSecurity)
  rootRules = Rules $rootSecurity
  entries = $entries
} | ConvertTo-Json -Depth 6 -Compress`;
}

export type MetadataRunner = (script: string) => Promise<string>;

/** Run the query with the system Windows PowerShell, bounded in time and output. */
export const powerShellMetadata: MetadataRunner = (script) =>
  new Promise((resolve, reject) => {
    execFile(
      join(
        process.env['SystemRoot'] ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 20_000, maxBuffer: 256 * 1024 },
      (error, stdout) =>
        error ? reject(new Error('metadata query failed', { cause: error })) : resolve(stdout),
    );
  });

function isRule(value: unknown): value is AccessRule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AccessRule).sid === 'string' &&
    typeof (value as AccessRule).allow === 'boolean'
  );
}

function rulesOf(value: unknown): AccessRule[] | undefined {
  // Windows PowerShell 5.1 serializes a one-element array as its element.
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.every(isRule) ? list : undefined;
}

/** Parse the query output strictly; anything unexpected is unverifiable. */
export function parseMetadata(output: string, names: readonly string[]): LogRootMetadata {
  let raw: unknown;
  try {
    raw = JSON.parse(output);
  } catch {
    throw new LogRootRefusedError('metadata-unavailable');
  }
  if (typeof raw !== 'object' || raw === null)
    throw new LogRootRefusedError('metadata-unavailable');
  const value = raw as Record<string, unknown>;
  const rootRules = rulesOf(value['rootRules']);
  const entries = value['entries'] as Record<string, unknown> | undefined;
  if (
    typeof value['user'] !== 'string' ||
    typeof value['driveType'] !== 'string' ||
    typeof value['driveFormat'] !== 'string' ||
    typeof value['rootAttributes'] !== 'number' ||
    typeof value['rootOwner'] !== 'string' ||
    typeof value['rootNullDacl'] !== 'boolean' ||
    !rootRules ||
    typeof entries !== 'object' ||
    entries === null
  )
    throw new LogRootRefusedError('metadata-unavailable');
  const parsed: Record<string, EntryMetadata | null> = {};
  for (const name of names) {
    const entry = entries[name] as Record<string, unknown> | null | undefined;
    if (entry === null) {
      parsed[name] = null;
      continue;
    }
    if (typeof entry !== 'object' || typeof entry['attributes'] !== 'number')
      throw new LogRootRefusedError('metadata-unavailable');
    const rules = entry['rules'] === undefined ? undefined : rulesOf(entry['rules']);
    if (entry['rules'] !== undefined && !rules)
      throw new LogRootRefusedError('metadata-unavailable');
    parsed[name] = {
      attributes: entry['attributes'],
      ...(typeof entry['owner'] === 'string' ? { owner: entry['owner'] } : {}),
      ...(typeof entry['nullDacl'] === 'boolean' ? { nullDacl: entry['nullDacl'] } : {}),
      ...(rules ? { rules } : {}),
    };
  }
  return {
    user: value['user'],
    driveType: value['driveType'],
    driveFormat: value['driveFormat'],
    rootAttributes: value['rootAttributes'],
    rootOwner: value['rootOwner'],
    rootNullDacl: value['rootNullDacl'],
    rootRules,
    entries: parsed,
  };
}

/** Principals that may own or access a private log root besides the operator. */
export function trustedPrincipals(user: string): Set<string> {
  return new Set([user, SYSTEM, ADMINISTRATORS, TRUSTED_INSTALLER, CREATOR_OWNER, OWNER_RIGHTS]);
}

function privateSecurity(
  owner: string | undefined,
  nullDacl: boolean | undefined,
  rules: AccessRule[] | undefined,
  trusted: Set<string>,
): boolean {
  return (
    owner !== undefined &&
    owner !== CREATOR_OWNER &&
    owner !== OWNER_RIGHTS &&
    trusted.has(owner) &&
    nullDacl === false &&
    rules !== undefined &&
    rules.every((rule) => !rule.allow || trusted.has(rule.sid))
  );
}

/**
 * Refuse a root that is not a private local NTFS directory, or any present managed name that
 * is a reparse point, directory, device, foreign-owned, unverifiable or readable by others.
 */
export function assertPrivateLogRoot(metadata: LogRootMetadata, names: readonly string[]): void {
  if (metadata.driveType !== 'Fixed' || metadata.driveFormat !== 'NTFS')
    throw new LogRootRefusedError('unsupported-filesystem');
  if ((metadata.rootAttributes & (REPARSE_POINT | DIRECTORY)) !== DIRECTORY)
    throw new LogRootRefusedError('not-directory');
  const trusted = trustedPrincipals(metadata.user);
  if (!privateSecurity(metadata.rootOwner, metadata.rootNullDacl, metadata.rootRules, trusted))
    throw new LogRootRefusedError('not-private');
  for (const name of names) {
    const entry = metadata.entries[name];
    if (entry === undefined) throw new LogRootRefusedError('metadata-unavailable');
    if (entry === null) continue;
    if ((entry.attributes & (REPARSE_POINT | DIRECTORY | DEVICE)) !== 0)
      throw new LogRootRefusedError('unsafe-entry');
    if (!privateSecurity(entry.owner, entry.nullDacl, entry.rules, trusted))
      throw new LogRootRefusedError('unsafe-entry');
  }
}

/** Query and validate the root and exact managed names. Read-only. */
export async function inspectLogRoot(
  root: string,
  names: readonly string[],
  run: MetadataRunner = powerShellMetadata,
): Promise<LogRootMetadata> {
  let output: string;
  try {
    output = await run(metadataScript(root, names));
  } catch {
    throw new LogRootRefusedError('metadata-unavailable');
  }
  const metadata = parseMetadata(output, names);
  assertPrivateLogRoot(metadata, names);
  return metadata;
}
