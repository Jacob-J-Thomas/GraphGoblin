// Bounded, typed evidence for the native Windows launcher acceptance job (#496).
//
// CI creates one fresh directory directly below the runner's temporary root (`init`), the
// acceptance suite appends typed observations to it as they happen, and `finalize` validates the
// flat files before the uploader receives their exact paths. Records hold only closed enums,
// bounded integers, booleans and validated identifiers. Fixture content, paths, arguments,
// environment, output text, error messages and log bytes are never copied.
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'graphgoblin.windows-launcher-evidence/1';
/** Read once by the acceptance suite and removed from its environment before any child starts. */
export const DIRECTORY_VARIABLE = 'GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_DIR';
export const ID_VARIABLE = 'GG_TEST_WINDOWS_LAUNCHER_EVIDENCE_ID';
export const DIRECTORY_PREFIX = 'windows-launcher-evidence-';
export const FILES = Object.freeze({
  manifest: 'manifest.json',
  observations: 'observations.ndjson',
  result: 'result.json',
});
/** The three files together stay below `totalBytes`. */
export const LIMITS = Object.freeze({
  totalBytes: 256 * 1024,
  manifestBytes: 8 * 1024,
  resultBytes: 16 * 1024,
  observationBytes: 192 * 1024,
  recordBytes: 1024,
  records: 1024,
});
/** Capacity kept for the closing fixture-state, overflow and recorder-closed records. */
const RESERVED_RECORDS = 16;
const MAX_FIXTURES = 12;

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));

/** A refused evidence operation; `reason` is one of a closed set of names. */
export class EvidenceRefusal extends Error {
  constructor(reason) {
    super(`Windows launcher evidence refused: ${reason}`);
    this.reason = reason;
  }
}

const integer = (min, max) => (value) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const boolean = (value) => typeof value === 'boolean';
const oneOf = (...values) => {
  const allowed = new Set(values);
  return (value) => typeof value === 'string' && allowed.has(value);
};
const matching = (pattern) => (value) =>
  typeof value === 'string' && value.length <= 64 && pattern.test(value);
const nullable = (check) => (value) => value === null || check(value);

const ERROR_CODE = /^(?:E[A-Z0-9]{2,24}|ERR_[A-Z0-9_]{2,48}|UNKNOWN)$/;
const SIGNAL = /^SIG[A-Z0-9]{2,8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIXTURE_ID = /^(?:[A-Za-z0-9]{6}|unrecognized)$/;
const ALIAS_STAGE =
  /^(?:create-alias|verify-alias|configure-fixture|capture-cli|assert-cli|unrecognized|(?:alias|direct)-(?:check-free-port|cold|cold-ready|release|cold-(?:alias|direct)-warm|cold-wrong-(?:store|settings)-config))$/;

export const CASES = Object.freeze([
  'installer',
  'launcher',
  'checkout-alias',
  'lock-contention',
  'bounded-logs',
]);
const TOOLS = [
  'compiler',
  'powershell',
  'system-tool',
  'launcher',
  'native-checks',
  'node',
  'other',
];
/** Launcher and NativeChecks flags, most specific first; `--ensure-gateway` accompanies others. */
const COMMAND_FLAGS = [
  'validate-install',
  'stage-shortcut',
  'stamp-shortcut',
  'inspect-shortcut',
  'read-shortcut-id',
  'expected-app-id',
  'create-shortcut',
  'stamp-window',
  'relaunch-window',
  'close-window',
  'window-fixture',
  'bounded-log-checks',
  'ensure-gateway',
];
const MODES = [
  ...COMMAND_FLAGS,
  'relaunch-checks',
  'compile',
  'acl',
  'user',
  'encoded-script',
  'script',
  'identity',
  'store-state',
  'module-import',
  'gateway',
  'inline-script',
  'other',
];
/** Closed launcher, installer and PowerShell outcomes recognised from the first 4 KiB of stderr. */
const DIAGNOSTICS = [
  ['startup-timeout', /did not become ready within \d+ seconds/],
  ['foreign-listener', /belongs to an unrelated or differently configured service/],
  ['foreign-gateway', /does not belong to this startup attempt/],
  ['store-acquiring', /another GraphGoblin process is acquiring this store/],
  [
    'store-held',
    /another GraphGoblin process holds this store|store is held or its ownership could not be verified/,
  ],
  ['store-unverified', /Store ownership could not be verified/],
  ['listener-not-ready', /is occupied but the configured GraphGoblin gateway is not ready/],
  ['destination-in-use', /log folder is in use/],
  ['destination-unavailable', /log folder is unsafe or unavailable/],
  ['import-failed-logged', /could not load its application modules\. A startup diagnostic/],
  ['import-failed-unlogged', /could not load its application modules, and no startup/],
  ['startup-failed-logged', /failed during startup\. A startup diagnostic/],
  ['startup-failed-unlogged', /failed during startup, and no startup diagnostic/],
  ['unknown-exit', /exited during startup with an unrecognized status/],
  ['helper-timeout', /did not answer the read-only identity\/ownership check/],
  ['helper-refused', /or store ownership could not be checked/],
  ['helper-unavailable', /configured Node runtime could not be started/],
  ['helper-invalid', /ownership helper returned an invalid result/],
  ['port-unknown', /whether port \d+ is free|port check had no confirmed outcome/],
  ['still-releasing', /still releasing its store/],
  ['spawn-failed', /Windows could not start the configured Node runtime/],
  ['launch-busy', /Another GraphGoblin launch(?:er)? is still/],
  ['gateway-incomplete', /unrecognized shutdown phase|built web app is unavailable/],
  [
    'configuration-refused',
    /is not built|not built:|does not match this launcher|Invalid staged|Invalid launcher|configuration is empty|Environment must contain|owned by the launcher|reserved for the launcher|staged launcher configuration/,
  ],
  [
    'installer-refused',
    /reserved GG_\*|Node was not found|distinct files and paths|Build the checkout first|-NodePath/,
  ],
  ['powershell-error-record', /^#< CLIXML/],
];
const DIAGNOSTIC_NAMES = [
  'none',
  'unavailable',
  'unclassified',
  ...DIAGNOSTICS.map(([name]) => name),
];
const FIXTURE_KINDS = [
  'installer',
  'launcher',
  'alias-sandbox',
  'alias-fixture',
  'alias-link',
  'contention',
  'logs',
];

const count = integer(0, 1_000_000);
const bytes = integer(0, 2 ** 40);
const duration = integer(0, 86_400_000);
const exitCode = integer(-2_147_483_648, 4_294_967_295);
const scope = { case: oneOf(...CASES, 'suite'), subtest: integer(0, 255) };
const failure = {
  failureKind: nullable(
    oneOf('assertion', 'child-exit', 'child-signal', 'system', 'subtests', 'other'),
  ),
  failureCode: nullable(matching(ERROR_CODE)),
  failureExit: nullable(exitCode),
  failureSignal: nullable(matching(SIGNAL)),
};
const aliasKind = oneOf('junction', 'dir');

/** Every field of every record type; records with missing or extra fields are rejected. */
const SCHEMAS = {
  'recorder-open': { evidenceId: matching(UUID) },
  'recorder-closed': {
    written: count,
    rejected: count,
    omittedRecords: count,
    omittedBytes: bytes,
  },
  overflow: { firstOmittedSeq: count },
  rejected: { recordType: (value) => value === 'unknown' || Object.hasOwn(SCHEMAS, value) },
  'case-start': { ...scope },
  'case-end': {
    ...scope,
    result: oneOf('pass', 'fail'),
    elapsedMs: duration,
    failedSubtests: count,
    ...failure,
  },
  child: {
    ...scope,
    child: count,
    tool: oneOf(...TOOLS),
    mode: oneOf(...MODES),
    outcome: oneOf('exit-zero', 'exit-nonzero', 'signal', 'spawn-error', 'error'),
    exitCode: nullable(exitCode),
    errorCode: nullable(matching(ERROR_CODE)),
    signal: nullable(matching(SIGNAL)),
    killed: boolean,
    timeoutMs: nullable(duration),
    elapsedMs: duration,
    stdoutBytes: nullable(bytes),
    stderrBytes: nullable(bytes),
    diagnostic: oneOf(...DIAGNOSTIC_NAMES),
  },
  fixture: { ...scope, fixture: matching(FIXTURE_ID), kind: oneOf(...FIXTURE_KINDS) },
  'fixture-state': {
    fixture: matching(FIXTURE_ID),
    kind: oneOf(...FIXTURE_KINDS),
    state: oneOf('directory', 'file', 'link', 'other', 'absent', 'unavailable'),
    errorCode: nullable(matching(ERROR_CODE)),
  },
  alias: {
    ...scope,
    kind: aliasKind,
    observedLinkType: oneOf('Junction', 'SymbolicLink', 'other', 'unobserved'),
    reparsePoint: nullable(boolean),
    directory: nullable(boolean),
    targetMatched: boolean,
    failureStage: nullable(matching(ALIAS_STAGE)),
    failureCode: nullable(matching(ERROR_CODE)),
    disposition: oneOf(
      'unlinked',
      'retained-release-unverified',
      'retained-unlink-refused',
      'retained-unverified-link',
      'not-created',
    ),
    unlinkFailure: nullable(matching(ERROR_CODE)),
  },
  'alias-round': {
    ...scope,
    kind: aliasKind,
    spelling: oneOf('alias', 'direct'),
    ownerVerified: boolean,
    release: oneOf('drained-pid-listener-leases', 'no-gateway-spawned', 'failed'),
    releaseFailure: nullable(matching(ERROR_CODE)),
  },
  contention: {
    ...scope,
    trial: integer(1, 16),
    contenders: integer(0, 64),
    acquired: integer(0, 64),
    refused: integer(0, 64),
    other: integer(0, 64),
  },
  cleanup: {
    ...scope,
    action: oneOf('gateway-drain', 'window-fixture', 'contenders'),
    result: oneOf('drained', 'not-running', 'failed', 'closed', 'killed'),
    count: nullable(integer(0, 64)),
  },
};

/**
 * Relations between fields that the recorder and the acceptance suite always keep: a passing test
 * has no failure fields, an unlinked alias had its target matched, only a failed release names a
 * failure, contention results account for every contender, and the overflow marker directly
 * follows the first omitted record. A record that breaks one did not come from them.
 */
const CONSISTENT = {
  'recorder-closed': (r) => (r.omittedRecords === 0) === (r.omittedBytes === 0),
  overflow: (r) => r.firstOmittedSeq === r.seq - 1,
  'case-end': (r) =>
    r.result === 'pass'
      ? r.failedSubtests === 0 &&
        r.failureKind === null &&
        r.failureCode === null &&
        r.failureExit === null &&
        r.failureSignal === null
      : r.failureKind !== null && (r.failureKind !== 'subtests' || r.failedSubtests > 0),
  alias: (r) =>
    (r.failureStage !== null || r.failureCode === null) &&
    (r.disposition !== 'unlinked' || (r.targetMatched && r.unlinkFailure === null)),
  'alias-round': (r) => r.release === 'failed' || r.releaseFailure === null,
  contention: (r) => r.acquired + r.refused + r.other === r.contenders,
};

/** True only for a record of a known type with exactly its declared, valid, consistent fields. */
export function validateRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return false;
  if (typeof record.type !== 'string' || !Object.hasOwn(SCHEMAS, record.type)) return false;
  const schema = SCHEMAS[record.type];
  const fields = ['seq', 'at', 'type', ...Object.keys(schema)];
  const keys = Object.keys(record);
  if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(record, field)))
    return false;
  if (!integer(1, 10_000_000)(record.seq) || !matching(TIMESTAMP)(record.at)) return false;
  if (!Object.entries(schema).every(([field, check]) => check(record[field]))) return false;
  return CONSISTENT[record.type]?.(record) ?? true;
}

/**
 * Facts the suite states once per run: a test or subtest start and end, the alias outcome of each
 * link kind, each alias round's release and each contention trial. A repeat cannot add evidence.
 */
const FACT_KEYS = {
  'case-start': (r) => `${r.case}:${r.subtest}`,
  'case-end': (r) => `${r.case}:${r.subtest}`,
  alias: (r) => r.kind,
  'alias-round': (r) => `${r.kind}:${r.spelling}`,
  contention: (r) => String(r.trial),
};
const factKey = (record) =>
  Object.hasOwn(FACT_KEYS, record.type) ? `${record.type}|${FACT_KEYS[record.type](record)}` : null;
/** Written only by the recorder itself; `record` refuses them like any other invalid record. */
const INTERNAL = new Set([
  'recorder-open',
  'recorder-closed',
  'overflow',
  'rejected',
  'fixture-state',
]);

/** Read a property of an arbitrary thrown value without letting a getter escape. */
function property(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

/** A stable tool and mode for a child command; arguments are matched, never copied. */
export function describeCommand(file, args = []) {
  const name = String(file).split(/[\\/]/).at(-1).toLowerCase();
  const values = new Set(Array.isArray(args) ? args.filter((arg) => typeof arg === 'string') : []);
  const flag = COMMAND_FLAGS.find((candidate) => values.has(`--${candidate}`));
  if (name === 'csc.exe') return { tool: 'compiler', mode: 'compile' };
  if (name === 'powershell.exe')
    return {
      tool: 'powershell',
      mode: values.has('-EncodedCommand') ? 'encoded-script' : 'script',
    };
  if (name === 'icacls.exe') return { tool: 'system-tool', mode: 'acl' };
  if (name === 'whoami.exe') return { tool: 'system-tool', mode: 'user' };
  if (name === 'nativechecks.exe')
    return { tool: 'native-checks', mode: flag ?? 'relaunch-checks' };
  if (name === 'node.exe' || name === 'node') {
    const entries = [...values];
    const mode = values.has('--input-type=module')
      ? entries.some((arg) => arg.endsWith('instance-identity.js'))
        ? 'module-import'
        : 'inline-script'
      : values.has('--store-state')
        ? 'store-state'
        : entries.some((arg) => arg.endsWith('instance-identity.js'))
          ? 'identity'
          : entries.some((arg) => arg.endsWith('main.js'))
            ? 'gateway'
            : 'other';
    return { tool: 'node', mode };
  }
  if (name.endsWith('.exe')) return { tool: 'launcher', mode: flag ?? 'other' };
  return { tool: 'other', mode: 'other' };
}

/** A closed diagnostic class for child stderr; the text itself never leaves this function. */
export function classifyDiagnostic(stderr) {
  if (stderr === undefined || stderr === null) return 'unavailable';
  const text = Buffer.isBuffer(stderr)
    ? stderr.subarray(0, 4096).toString('utf8')
    : typeof stderr === 'string'
      ? stderr.slice(0, 4096)
      : undefined;
  if (text === undefined) return 'unavailable';
  if (text === '') return 'none';
  return DIAGNOSTICS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'unclassified';
}

const byteCount = (output) =>
  typeof output === 'string'
    ? Buffer.byteLength(output, 'utf8')
    : Buffer.isBuffer(output)
      ? output.length
      : null;

/** Typed fields for one settled child process. */
export function childFields({ ok, value, description, timeout, elapsedMs }) {
  const code = ok ? 0 : property(value, 'code');
  const exit = Number.isSafeInteger(code) && exitCode(code) ? code : null;
  const errorCode = typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
  const rawSignal = property(value, 'signal');
  const signal = typeof rawSignal === 'string' && SIGNAL.test(rawSignal) ? rawSignal : null;
  const outcome =
    exit === 0
      ? 'exit-zero'
      : exit !== null
        ? 'exit-nonzero'
        : signal
          ? 'signal'
          : errorCode && !errorCode.startsWith('ERR_')
            ? 'spawn-error'
            : 'error';
  return {
    tool: description.tool,
    mode: description.mode,
    outcome,
    exitCode: exit,
    errorCode,
    signal,
    killed: property(value, 'killed') === true,
    timeoutMs: duration(timeout) && timeout > 0 ? timeout : null,
    elapsedMs: Math.min(86_400_000, Math.max(0, Math.round(elapsedMs))),
    stdoutBytes: byteCount(property(value, 'stdout')),
    stderrBytes: byteCount(property(value, 'stderr')),
    diagnostic: classifyDiagnostic(property(value, 'stderr')),
  };
}

/** Failure fields from a thrown value: its kind, error code, exit status or signal only. */
export function failureFields(error, failedSubtests = 0) {
  if (error === undefined)
    return {
      failureKind: failedSubtests > 0 ? 'subtests' : null,
      failureCode: null,
      failureExit: null,
      failureSignal: null,
    };
  const code = property(error, 'code');
  const failureExit = Number.isSafeInteger(code) && exitCode(code) ? code : null;
  const failureCode = typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
  const rawSignal = property(error, 'signal');
  const failureSignal = typeof rawSignal === 'string' && SIGNAL.test(rawSignal) ? rawSignal : null;
  const failureKind =
    code === 'ERR_ASSERTION' || property(error, 'name') === 'AssertionError'
      ? 'assertion'
      : failureSignal
        ? 'child-signal'
        : failureExit !== null
          ? 'child-exit'
          : failureCode
            ? 'system'
            : 'other';
  return { failureKind, failureCode, failureExit, failureSignal };
}

/** An error code only when it is one of the recognised code shapes. */
export const errorCodeOf = (error) => {
  const code = property(error, 'code');
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
};

/** A checkout-alias lifecycle stage name, or `unrecognized`. */
export const aliasStage = (stage) =>
  typeof stage === 'string' && ALIAS_STAGE.test(stage) ? stage : 'unrecognized';

/** The existence and type of one path, observed without following links or traversing it. */
export function pathState(path) {
  try {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (entry === undefined) return { state: 'absent', errorCode: null };
    const state = entry.isSymbolicLink()
      ? 'link'
      : entry.isDirectory()
        ? 'directory'
        : entry.isFile()
          ? 'file'
          : 'other';
    return { state, errorCode: null };
  } catch (error) {
    return { state: 'unavailable', errorCode: errorCodeOf(error) };
  }
}

/** The six-character random suffix of a `mkdtemp` name, or `unrecognized`. */
export function fixtureId(path) {
  const name = String(path).split(/[\\/]/).at(-1);
  const suffix = name.slice(-6);
  return name.length > 6 && /^[A-Za-z0-9]{6}$/.test(suffix) ? suffix : 'unrecognized';
}

const contains = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
};

function runnerTempRoot(runnerTemp) {
  if (typeof runnerTemp !== 'string' || runnerTemp === '' || !isAbsolute(runnerTemp))
    throw new EvidenceRefusal('runner-temp-missing');
  const entry = lstatSync(runnerTemp, { throwIfNoEntry: false });
  if (!entry || entry.isSymbolicLink() || !entry.isDirectory())
    throw new EvidenceRefusal('runner-temp-unsafe');
  return realpathSync.native(runnerTemp);
}

/**
 * The validated evidence directory: an ordinary, canonical directory with the evidence name,
 * directly below the canonical runner temp and outside the checkout. Nothing is followed,
 * created or removed.
 */
export function verifyEvidenceDirectory(directory, runnerTemp, repoRoot = defaultRoot) {
  if (
    typeof directory !== 'string' ||
    !isAbsolute(directory) ||
    /[\0\r\n*?[\]{}]/.test(directory) ||
    directory.startsWith('!')
  )
    throw new EvidenceRefusal('invalid-path');
  const temp = runnerTempRoot(runnerTemp);
  const entry = lstatSync(directory, { throwIfNoEntry: false });
  if (!entry) throw new EvidenceRefusal('missing');
  if (entry.isSymbolicLink()) throw new EvidenceRefusal('link');
  if (!entry.isDirectory()) throw new EvidenceRefusal('not-directory');
  if (realpathSync.native(directory) !== directory) throw new EvidenceRefusal('not-canonical');
  if (dirname(directory) !== temp) throw new EvidenceRefusal('outside-runner-temp');
  if (!new RegExp(`^${DIRECTORY_PREFIX}[A-Za-z0-9]{6}$`).test(basename(directory)))
    throw new EvidenceRefusal('unexpected-name');
  const repository = realpathSync.native(repoRoot);
  if (contains(repository, directory) || contains(directory, repository))
    throw new EvidenceRefusal('inside-checkout');
  return directory;
}

const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

/** Bytes of one ordinary single-link file, or null when absent. Links are never followed. */
export function readBounded(path, limit) {
  const named = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!named) return null;
  if (named.isSymbolicLink()) throw new EvidenceRefusal('link');
  if (!named.isFile()) throw new EvidenceRefusal('not-file');
  if (named.nlink !== 1n) throw new EvidenceRefusal('hard-link');
  if (named.size > BigInt(limit)) throw new EvidenceRefusal('oversized');
  const fd = openSync(path, 'r');
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!sameFile(opened, named) || opened.nlink !== 1n) throw new EvidenceRefusal('unsafe-file');
    const buffer = Buffer.alloc(limit + 1);
    let total = 0;
    for (;;) {
      const read = readSync(fd, buffer, total, buffer.length - total, null);
      if (read === 0) break;
      total += read;
      if (total > limit) throw new EvidenceRefusal('oversized');
    }
    return buffer.subarray(0, total);
  } finally {
    closeSync(fd);
  }
}

/** Create a new ordinary file exclusively; an existing name, including a link, is refused. */
function createExclusive(path) {
  let fd;
  try {
    fd = openSync(path, 'wx');
  } catch (error) {
    throw new EvidenceRefusal(property(error, 'code') === 'EEXIST' ? 'exists' : 'unwritable');
  }
  try {
    const opened = fstatSync(fd, { bigint: true });
    const named = lstatSync(path, { bigint: true });
    if (
      named.isSymbolicLink() ||
      !named.isFile() ||
      !sameFile(opened, named) ||
      opened.nlink !== 1n
    )
      throw new EvidenceRefusal('unsafe-file');
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function writeAll(fd, buffer) {
  for (let offset = 0; offset < buffer.length;)
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
}

function writeExclusive(path, text, limit) {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length > limit) throw new EvidenceRefusal('oversized');
  const fd = createExclusive(path);
  try {
    writeAll(fd, buffer);
  } finally {
    closeSync(fd);
  }
}

const composeManifest = ({ evidenceId, createdAt, binding }) => ({
  schema: SCHEMA,
  state: 'initialized',
  evidenceId,
  createdAt,
  limits: LIMITS,
  files: FILES,
  binding,
});
const serializeManifest = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The manifest `init` wrote, or a refusal. The manifest is rebuilt from its validated values, the
 * static limits and file names, and the binding fields derived from them, and must equal the file
 * byte for byte: an unknown or repeated field at any depth, a byte-order mark, other whitespace or
 * an inconsistent derived field is refused before anything is published. This checks shape, not
 * authenticity: a runner that controls the files can still write a well-formed manifest.
 */
export function parseManifest(content) {
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content));
  } catch {
    throw new EvidenceRefusal('manifest-invalid');
  }
  const binding = isObject(value) ? bindingFrom(value.binding) : null;
  if (
    binding === null ||
    value.schema !== SCHEMA ||
    value.state !== 'initialized' ||
    !matching(UUID)(value.evidenceId) ||
    !matching(TIMESTAMP)(value.createdAt)
  )
    throw new EvidenceRefusal('manifest-invalid');
  const manifest = composeManifest({
    evidenceId: value.evidenceId,
    createdAt: value.createdAt,
    binding,
  });
  if (!Buffer.from(serializeManifest(manifest), 'utf8').equals(content))
    throw new EvidenceRefusal('manifest-invalid');
  return manifest;
}

function readManifest(directory) {
  const content = readBounded(join(directory, FILES.manifest), LIMITS.manifestBytes);
  if (content === null) throw new EvidenceRefusal('manifest-missing');
  return parseManifest(content);
}

/**
 * Appends validated records to the evidence file as they occur, synchronously so a later
 * failure or crash cannot lose earlier records. It never throws into the suite: invalid or
 * oversized records become `rejected` records, capacity overflow is counted, and a write
 * failure stops recording with one stdout marker.
 */
export class Recorder {
  #fd;
  #log;
  #now;
  #clock;
  #store = new AsyncLocalStorage();
  #seq = 0;
  #bytes = 0;
  #written = 0;
  #rejected = 0;
  #omittedRecords = 0;
  #omittedBytes = 0;
  #overflowed = false;
  #closed = false;
  #fixtures = [];
  #facts = new Set();

  /** With an `evidenceId`, the first record written is the stream's only `recorder-open`. */
  constructor({
    fd = null,
    state = 'disabled',
    log = console.log,
    now = () => new Date(),
    clock = () => performance.now(),
    evidenceId = null,
  } = {}) {
    this.#fd = fd;
    this.state = state;
    this.#log = log;
    this.#now = now;
    this.#clock = clock;
    if (evidenceId !== null) this.#write('recorder-open', { evidenceId }, false, true);
  }

  /**
   * Record one typed observation; scope fields come from the running test when omitted. The
   * recorder's own lifecycle types and a repeat of a once-per-run fact become `rejected`.
   */
  record(type, fields = {}) {
    return this.#write(type, fields, false);
  }

  #write(type, fields, tail, internal = false) {
    if (this.#closed) return null;
    try {
      const schema = Object.hasOwn(SCHEMAS, type) ? SCHEMAS[type] : undefined;
      const current = this.#store.getStore();
      const scoped =
        schema && 'case' in schema && current && !Object.hasOwn(fields, 'case')
          ? { case: current.case, subtest: current.subtest, ...fields }
          : fields;
      const reserved = ['seq', 'at', 'type'].some((key) => Object.hasOwn(scoped, key));
      const record = Object.assign(
        { seq: ++this.#seq, at: this.#now().toISOString(), type },
        reserved ? {} : scoped,
      );
      const valid = !reserved && (internal || !INTERNAL.has(type)) && validateRecord(record);
      const line = valid ? Buffer.from(`${JSON.stringify(record)}\n`, 'utf8') : null;
      // Bounded fields keep valid records far below the limit; the size check is a backstop.
      if (!valid || line.length > LIMITS.recordBytes || !this.#firstStatement(record))
        return this.#append(this.#rejection(type), tail);
      return this.#append(record, tail, line);
    } catch {
      return null;
    }
  }

  #firstStatement(record) {
    const key = factKey(record);
    if (key === null) return true;
    if (this.#facts.has(key)) return false;
    this.#facts.add(key);
    return true;
  }

  #rejection(type) {
    const record = {
      seq: ++this.#seq,
      at: this.#now().toISOString(),
      type: 'rejected',
      recordType: Object.hasOwn(SCHEMAS, type) ? type : 'unknown',
    };
    // Counted only once the record exists, so every counted rejection is written or omitted.
    this.#rejected++;
    return record;
  }

  #append(record, tail, line = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')) {
    const reserve = tail ? 0 : RESERVED_RECORDS;
    if (
      this.#bytes + line.length > LIMITS.observationBytes - reserve * LIMITS.recordBytes ||
      this.#written + 1 > LIMITS.records - reserve
    ) {
      this.#omittedRecords++;
      this.#omittedBytes += line.length;
      if (!this.#overflowed) {
        this.#overflowed = true;
        this.#write('overflow', { firstOmittedSeq: record.seq }, true, true);
      }
      return record;
    }
    if (this.#fd !== null) {
      try {
        writeAll(this.#fd, line);
      } catch (error) {
        this.#stop('write-failed', error);
        return record;
      }
    }
    this.#bytes += line.length;
    this.#written++;
    return record;
  }

  #stop(state, error) {
    const fd = this.#fd;
    this.#fd = null;
    this.state = state;
    try {
      closeSync(fd);
    } catch {
      // The descriptor is already unusable; the marker below reports the state.
    }
    this.#log(
      JSON.stringify({
        evidence: 'windows-launcher-export',
        state,
        errorCode: errorCodeOf(error),
      }),
    );
  }

  #marker(record) {
    if (record) this.#log(JSON.stringify({ evidence: 'windows-launcher-observation', ...record }));
  }

  /** Wrap a promise-returning execFile so each settled child adds one typed record. */
  observeExecFile(run) {
    return (file, args, options) => {
      const started = this.#clock();
      const current = this.#store.getStore();
      const description = describeCommand(file, args);
      const child = current ? ++current.children : 0;
      const promise = run(file, args, options);
      const settle = (ok, value) => {
        const record = this.record('child', {
          case: current?.case ?? 'suite',
          subtest: current?.subtest ?? 0,
          child,
          ...childFields({
            ok,
            value,
            description,
            timeout: property(options, 'timeout'),
            elapsedMs: this.#clock() - started,
          }),
        });
        if (current && record?.type === 'child') current.lastChild = record;
      };
      promise.then(
        (value) => settle(true, value),
        (error) => settle(false, error),
      );
      return promise;
    };
  }

  /** Wrap a node:test body so it and its subtests record start, end and failure fields. */
  observeTest(caseId, body) {
    return (t) => this.#run(this.#scope(caseId, 0, null), t, body);
  }

  /** Subtests are numbered across their whole case, so nested subtests never share a number. */
  #scope(caseId, subtest, parent) {
    return {
      case: caseId,
      subtest,
      parent,
      numbering: parent?.numbering ?? { subtests: 0 },
      children: 0,
      failedSubtests: 0,
      lastChild: null,
    };
  }

  async #run(current, t, body) {
    this.record('case-start', { case: current.case, subtest: current.subtest });
    const started = this.#clock();
    let thrown = false;
    let error;
    try {
      return await this.#store.run(current, () =>
        body(t === undefined ? t : this.#observedContext(t, current)),
      );
    } catch (caught) {
      thrown = true;
      error = caught;
      throw caught;
    } finally {
      const failed = thrown || current.failedSubtests > 0;
      if (failed && current.parent) current.parent.failedSubtests++;
      const end = this.record('case-end', {
        case: current.case,
        subtest: current.subtest,
        result: failed ? 'fail' : 'pass',
        elapsedMs: Math.min(86_400_000, Math.max(0, Math.round(this.#clock() - started))),
        failedSubtests: current.failedSubtests,
        // Even a thrown `undefined` or `null` is a failure with a kind.
        ...failureFields(thrown ? (error ?? {}) : undefined, current.failedSubtests),
      });
      if (failed) {
        this.#marker(end);
        this.#marker(current.lastChild);
      }
    }
  }

  #observedContext(t, current) {
    return new Proxy(t, {
      get: (target, key) => {
        if (key === 'test')
          return (name, ...rest) => {
            const index = rest.findIndex((item) => typeof item === 'function');
            if (index >= 0) {
              const body = rest[index];
              const child = this.#scope(current.case, ++current.numbering.subtests, current);
              rest[index] = (subtest) => this.#run(child, subtest, body);
            }
            return target.test(name, ...rest);
          };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  /** Register a fixture root; its existence and type are recorded again at close. */
  fixture(kind, path, id = fixtureId(path)) {
    if (this.#fixtures.length < MAX_FIXTURES) this.#fixtures.push({ kind, path, id });
    this.record('fixture', { fixture: id, kind });
    return id;
  }

  /** Final fixture states and counts. Called once at process exit; later records are ignored. */
  close() {
    if (this.#closed) return;
    for (const { kind, path, id } of this.#fixtures)
      this.#write('fixture-state', { fixture: id, kind, ...pathState(path) }, true, true);
    this.#write(
      'recorder-closed',
      {
        written: this.#written,
        rejected: this.#rejected,
        omittedRecords: this.#omittedRecords,
        omittedBytes: this.#omittedBytes,
      },
      true,
      true,
    );
    this.#closed = true;
    if (this.#fd !== null) {
      const fd = this.#fd;
      this.#fd = null;
      try {
        closeSync(fd);
      } catch {
        // Every record was already written synchronously.
      }
    }
  }
}

/**
 * Open the acceptance suite's recorder. Without the CI variable it records nothing to disk and
 * the local command is unchanged. The variable is removed from `env` before any child starts.
 */
export function openWindowsLauncherEvidence({
  env = process.env,
  repoRoot = defaultRoot,
  log = console.log,
  onExit = (close) => process.once('exit', close),
  now,
  clock,
} = {}) {
  const requested = env[DIRECTORY_VARIABLE];
  delete env[DIRECTORY_VARIABLE];
  if (requested === undefined || requested === '')
    return new Recorder({ state: 'disabled', log, now, clock });
  try {
    const directory = verifyEvidenceDirectory(requested, env.RUNNER_TEMP, repoRoot);
    const { evidenceId } = readManifest(directory);
    const fd = createExclusive(join(directory, FILES.observations));
    const recorder = new Recorder({ fd, state: 'recording', log, now, clock, evidenceId });
    log(JSON.stringify({ evidence: 'windows-launcher-export', state: 'recording', evidenceId }));
    onExit(() => recorder.close());
    return recorder;
  } catch (error) {
    const reason = error instanceof EvidenceRefusal ? error.reason : 'unavailable';
    log(JSON.stringify({ evidence: 'windows-launcher-export', state: 'refused', reason }));
    return new Recorder({ state: 'refused', log, now, clock });
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const BINDINGS = [
  ['repository', 'GITHUB_REPOSITORY', /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/],
  [
    'workflowRef',
    'GITHUB_WORKFLOW_REF',
    /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/\.github\/workflows\/[A-Za-z0-9_.-]{1,100}@refs\/(?:heads|pull|tags)\/[A-Za-z0-9_./-]{1,200}$/,
  ],
  ['job', 'GITHUB_JOB', /^[A-Za-z0-9_-]{1,100}$/],
  ['runId', 'GITHUB_RUN_ID', /^[1-9][0-9]{0,19}$/],
  ['runAttempt', 'GITHUB_RUN_ATTEMPT', /^[1-9][0-9]{0,4}$/],
  ['event', 'GITHUB_EVENT_NAME', /^[a-z_]{1,40}$/],
  ['ref', 'GITHUB_REF', /^refs\/(?:heads|pull|tags)\/[A-Za-z0-9_./-]{1,200}$/],
  ['sha', 'GITHUB_SHA', SHA],
  ['eventHead', 'GG_TEST_EVIDENCE_EVENT_HEAD', SHA],
  ['eventBase', 'GG_TEST_EVIDENCE_EVENT_BASE', SHA],
  ['runnerOs', 'RUNNER_OS', /^(?:Windows|Linux|macOS)$/],
  ['runnerArch', 'RUNNER_ARCH', /^(?:X86|X64|ARM|ARM64)$/],
  ['imageVersion', 'ImageVersion', /^[0-9]{8}\.[0-9]{1,6}(?:\.[0-9]{1,6})?$/],
];

/** The checked-out commit, tree and parents from the commit header (shallow checkouts too). */
export function observeCheckout(git) {
  try {
    const head = git(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
    if (!SHA.test(head)) throw new Error('unrecognised head');
    const header = git(['cat-file', 'commit', head]).split('\n\n', 1)[0].split('\n');
    const tree = header.find((line) => line.startsWith('tree '))?.slice(5);
    const parents = header
      .filter((line) => line.startsWith('parent '))
      .map((line) => line.slice(7));
    if (!SHA.test(tree ?? '') || parents.length > 8 || !parents.every((sha) => SHA.test(sha)))
      throw new Error('unrecognised commit header');
    return { state: 'observed', head, tree, parents };
  } catch {
    return { state: 'unavailable', head: null, tree: null, parents: [] };
  }
}

const NODE_VERSION = /^v[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;
const text = (pattern) => (value) => typeof value === 'string' && pattern.test(value);

/**
 * The binding in its one canonical shape. `unavailable` lists every null value (the event base
 * only for a pull request, where it applies) and the checkout comparisons are computed from the
 * values, so a manifest can be rebuilt from its own content.
 */
function composeBinding({ checkout, node, ...values }) {
  const merge = values.event === 'pull_request';
  const unavailable = BINDINGS.map(([name]) => name).filter(
    (name) => values[name] === null && (name !== 'eventBase' || merge),
  );
  if (checkout.state !== 'observed') unavailable.push('checkout');
  if (node === null) unavailable.push('node');
  const same = (a, b) => (a === null || b === null || a === undefined ? null : a === b);
  return {
    unavailable,
    ...Object.fromEntries(BINDINGS.map(([name]) => [name, values[name]])),
    checkout: {
      state: checkout.state,
      head: checkout.head,
      tree: checkout.tree,
      parents: checkout.parents,
      matchesSha: same(checkout.head, values.sha),
      headMatchesEventHead: merge ? null : same(checkout.head, values.eventHead),
      baseParentMatchesEventBase: merge ? same(checkout.parents[0], values.eventBase) : null,
      headParentMatchesEventHead: merge ? same(checkout.parents[1], values.eventHead) : null,
    },
    node,
  };
}

/** Validated run and checkout bindings; absent or malformed values are null and listed. */
export function describeBinding(env, git) {
  const values = Object.fromEntries(
    BINDINGS.map(([name, variable, pattern]) => [
      name,
      text(pattern)(env[variable]) ? env[variable] : null,
    ]),
  );
  const node = NODE_VERSION.test(process.version) ? process.version : null;
  return composeBinding({ ...values, checkout: observeCheckout(git), node });
}

/** The canonical binding rebuilt from a parsed manifest's values, or null when one is invalid. */
function bindingFrom(binding) {
  if (!isObject(binding) || !isObject(binding.checkout)) return null;
  const values = {};
  for (const [name, , pattern] of BINDINGS) {
    if (binding[name] !== null && !text(pattern)(binding[name])) return null;
    values[name] = binding[name];
  }
  const { state, head, tree, parents } = binding.checkout;
  const observed =
    state === 'observed' &&
    text(SHA)(head) &&
    text(SHA)(tree) &&
    Array.isArray(parents) &&
    parents.length <= 8 &&
    parents.every(text(SHA));
  const absent =
    state === 'unavailable' &&
    head === null &&
    tree === null &&
    Array.isArray(parents) &&
    parents.length === 0;
  if ((!observed && !absent) || (binding.node !== null && !text(NODE_VERSION)(binding.node)))
    return null;
  return composeBinding({
    ...values,
    checkout: { state, head, tree, parents: [...parents] },
    node: binding.node,
  });
}

/**
 * The run identity complete evidence must bind. The runner OS, architecture and image and the Node
 * version are diagnostics that may stay unavailable; the event head and base count only through
 * the checkout comparisons that apply to the event.
 */
const RUN_IDENTITY = ['repository', 'workflowRef', 'job', 'runId', 'runAttempt', 'event', 'ref'];

/**
 * Binding requirements of complete evidence: every run identity value is present and every
 * checkout comparison that applies to the event holds. A missing or malformed identity value is
 * null and reported once; a false comparison is a known contradiction; a null one leaves the
 * revision unverified.
 */
export function bindingRequirements(binding) {
  const { event, checkout } = binding;
  const applicable =
    event === 'pull_request'
      ? [
          checkout.matchesSha,
          checkout.baseParentMatchesEventBase,
          checkout.headParentMatchesEventHead,
        ]
      : [checkout.matchesSha, checkout.headMatchesEventHead];
  return [
    ...(RUN_IDENTITY.some((name) => binding[name] === null) ? ['binding-identity'] : []),
    ...(applicable.includes(false) ? ['binding-contradiction'] : []),
    ...(applicable.includes(null) ? ['binding-unverified'] : []),
  ];
}

function runGit(repoRoot) {
  return (args) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      timeout: 15_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
}

/** Create the fresh evidence directory and its binding manifest. */
export function initializeEvidence({
  env = process.env,
  repoRoot = defaultRoot,
  git = runGit(repoRoot),
  now = () => new Date(),
} = {}) {
  const temp = runnerTempRoot(env.RUNNER_TEMP);
  const repository = realpathSync.native(repoRoot);
  if (contains(repository, temp) || contains(temp, repository))
    throw new EvidenceRefusal('inside-checkout');
  const directory = verifyEvidenceDirectory(
    mkdtempSync(join(temp, DIRECTORY_PREFIX)),
    env.RUNNER_TEMP,
    repoRoot,
  );
  const evidenceId = randomUUID();
  const manifest = composeManifest({
    evidenceId,
    createdAt: now().toISOString(),
    binding: describeBinding(env, git),
  });
  writeExclusive(
    join(directory, FILES.manifest),
    serializeManifest(manifest),
    LIMITS.manifestBytes,
  );
  return { directory, evidenceId, manifest };
}

/** Parse and validate the observation file; any invalid line rejects the whole file. */
export function parseObservations(content, evidenceId) {
  const rejected = (reason) => ({ state: 'rejected', reason, records: [] });
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
  } catch {
    return rejected('encoding');
  }
  // The recorder never writes a byte-order mark, so a file that starts with one is not its output.
  if (decoded.charCodeAt(0) === 0xfeff) return rejected('byte-order-mark');
  if (decoded !== '' && !decoded.endsWith('\n')) return rejected('incomplete-line');
  const lines = decoded === '' ? [] : decoded.slice(0, -1).split('\n');
  if (lines.length > LIMITS.records) return rejected('too-many-records');
  const records = [];
  for (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') + 1 > LIMITS.recordBytes)
      return rejected('oversized-record');
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return rejected('malformed-record');
    }
    // Canonical bytes only: duplicate keys or extra whitespace could carry unvalidated text.
    if (!validateRecord(record) || JSON.stringify(record) !== line)
      return rejected('invalid-record');
    if (records.length > 0 && record.seq <= records.at(-1).seq) return rejected('out-of-order');
    records.push(record);
  }
  if (records[0]?.type !== 'recorder-open' || records[0].evidenceId !== evidenceId)
    return rejected('unbound');
  const contradiction = streamContradiction(records);
  if (contradiction !== null) return rejected(contradiction);
  return { state: 'valid', reason: null, records };
}

/**
 * The recorder writes one opening record first, at most one `overflow` record, and at most one
 * closing record last whose counts match the stream; and it refuses a repeated once-per-run fact.
 * Each rejection the closer counts is a `rejected` record in the stream or one of its omitted
 * records, so without omissions its count equals the stream's. A stream that breaks either rule is
 * not the recorder's output.
 */
function streamContradiction(records) {
  const facts = new Set();
  let overflows = 0;
  let rejections = 0;
  for (const [index, record] of records.entries()) {
    if (record.type === 'overflow') overflows++;
    if (record.type === 'rejected') rejections++;
    if (
      (index > 0 && record.type === 'recorder-open') ||
      overflows > 1 ||
      (record.type === 'recorder-closed' &&
        (index !== records.length - 1 ||
          record.written !== index ||
          record.rejected < rejections ||
          record.rejected > rejections + record.omittedRecords ||
          record.omittedRecords > 0 !== (overflows === 1)))
    )
      return 'lifecycle';
    const key = factKey(record);
    if (key !== null) {
      if (facts.has(key)) return 'duplicate-fact';
      facts.add(key);
    }
  }
  return null;
}

/**
 * The lock-contention trials and the alias-round spellings the acceptance suite runs. Each must be
 * its own record from its own case: repeating one trial or spelling never stands in for another.
 */
const CONTENTION_TRIALS = [1, 2, 3];
const ALIAS_SPELLINGS = ['alias', 'direct'];

/** Counts and per-case outcomes from validated records. */
export function summarize(records) {
  const byType = {};
  const cases = Object.fromEntries(
    CASES.map((name) => [
      name,
      {
        started: false,
        result: null,
        subtestsStarted: 0,
        subtestsPassed: 0,
        subtestsFailed: 0,
        subtestsUnpaired: 0,
        children: 0,
        childFailures: 0,
      },
    ]),
  );
  const subtests = Object.fromEntries(CASES.map((name) => [name, new Map()]));
  const closedAt = records.findIndex((record) => record.type === 'recorder-closed');
  const closed = closedAt >= 0 ? records[closedAt] : null;
  const fixtures = new Set();
  const states = new Set();
  const aliases = { junction: { record: null, released: [] }, dir: { record: null, released: [] } };
  const trials = new Set();
  for (const record of records) {
    byType[record.type] = (byType[record.type] ?? 0) + 1;
    const entry = Object.hasOwn(cases, record.case) ? cases[record.case] : undefined;
    const starts = record.type === 'case-start';
    if ((starts || record.type === 'case-end') && entry) {
      if (record.subtest === 0) {
        if (starts) entry.started = true;
        else entry.result = record.result;
      } else {
        // A subtest counts once its start and its end are both recorded.
        const pair = subtests[record.case].get(record.subtest) ?? { started: false, result: null };
        if (starts) pair.started = true;
        else pair.result = record.result;
        subtests[record.case].set(record.subtest, pair);
      }
    } else if (record.type === 'child' && entry) {
      entry.children++;
      if (record.outcome !== 'exit-zero') entry.childFailures++;
    } else if (record.type === 'fixture') fixtures.add(`${record.kind}:${record.fixture}`);
    else if (record.type === 'fixture-state') states.add(`${record.kind}:${record.fixture}`);
    else if (record.case === 'checkout-alias' && record.type === 'alias')
      aliases[record.kind].record = record;
    else if (
      record.case === 'checkout-alias' &&
      record.type === 'alias-round' &&
      record.ownerVerified === true &&
      record.release === 'drained-pid-listener-leases' &&
      record.releaseFailure === null
    )
      aliases[record.kind].released.push(record.spelling);
    else if (
      record.case === 'lock-contention' &&
      record.type === 'contention' &&
      record.contenders >= 2 &&
      record.acquired === 1 &&
      record.other === 0
    )
      trials.add(record.trial);
  }
  for (const name of CASES)
    for (const { started, result } of subtests[name].values()) {
      const entry = cases[name];
      if (started) entry.subtestsStarted++;
      if (started && result === 'pass') entry.subtestsPassed++;
      if (result === 'fail') entry.subtestsFailed++;
      if (!started || result === null) entry.subtestsUnpaired++;
    }
  return {
    records: records.length,
    byType,
    closed: closed !== null && closed.written === closedAt,
    rejected: byType.rejected ?? 0,
    omittedRecords: closed?.omittedRecords ?? 0,
    omittedBytes: closed?.omittedBytes ?? 0,
    cases,
    aliases,
    contention: [...trials].sort((a, b) => a - b),
    fixturesWithoutState: [...fixtures].filter((fixture) => !states.has(fixture)).length,
  };
}

/**
 * Cases whose native work runs through observed `execFile` children. Lock contention starts its
 * long-lived contenders with `spawn`; its required evidence is the contention trial records.
 */
const CHILD_CASES = new Set(['installer', 'launcher', 'checkout-alias', 'bounded-logs']);

/** Required observations that a passing native run has not provided. */
export function missingRequirements(summary) {
  const missing = [];
  if (!summary.closed) missing.push('recorder-closed');
  if (summary.omittedRecords > 0) missing.push('records-omitted');
  if (summary.rejected > 0) missing.push('records-rejected');
  for (const [name, entry] of Object.entries(summary.cases)) {
    if (!entry.started) missing.push(`${name}-start`);
    if (entry.result !== 'pass') missing.push(`${name}-pass`);
    if (CHILD_CASES.has(name) && entry.children === 0) missing.push(`${name}-children`);
    if (entry.subtestsFailed > 0 || entry.subtestsUnpaired > 0) missing.push(`${name}-subtests`);
  }
  for (const [kind, { record, released }] of Object.entries(summary.aliases)) {
    if (!record?.targetMatched || record.disposition !== 'unlinked' || record.failureStage !== null)
      missing.push(`alias-${kind}`);
    if (!ALIAS_SPELLINGS.every((spelling) => released.includes(spelling)))
      missing.push(`alias-${kind}-release`);
  }
  if (!CONTENTION_TRIALS.every((trial) => summary.contention.includes(trial)))
    missing.push('contention-trials');
  if (summary.fixturesWithoutState > 0) missing.push('fixture-states');
  return missing;
}

const STEP_OUTCOMES = new Set(['success', 'failure', 'cancelled', 'skipped']);
const stepOutcome = (value) => (STEP_OUTCOMES.has(value) ? value : 'unknown');

/**
 * Validate the evidence directory and write `result.json`. Returns the exact files to upload;
 * an unsafe or unowned directory or file is refused before anything is written.
 */
export function finalizeEvidence({
  env = process.env,
  repoRoot = defaultRoot,
  now = () => new Date(),
} = {}) {
  const directory = verifyEvidenceDirectory(env[DIRECTORY_VARIABLE], env.RUNNER_TEMP, repoRoot);
  const allowed = new Set([FILES.manifest, FILES.observations]);
  if (readdirSync(directory).some((name) => !allowed.has(name)))
    throw new EvidenceRefusal('unexpected-entry');
  const manifest = readManifest(directory);
  if (manifest.evidenceId !== env[ID_VARIABLE]) throw new EvidenceRefusal('unowned');
  const content = readBounded(join(directory, FILES.observations), LIMITS.observationBytes);
  const steps = {
    install: stepOutcome(env.GG_TEST_EVIDENCE_INSTALL_OUTCOME),
    build: stepOutcome(env.GG_TEST_EVIDENCE_BUILD_OUTCOME),
    native: stepOutcome(env.GG_TEST_EVIDENCE_NATIVE_OUTCOME),
  };
  const parsed =
    content === null
      ? { state: 'absent', reason: null, records: [] }
      : parseObservations(content, manifest.evidenceId);
  const summary = summarize(parsed.records);
  const missing = [
    ...(parsed.state === 'valid' ? missingRequirements(summary) : [`observations-${parsed.state}`]),
    ...bindingRequirements(manifest.binding),
  ];
  const status =
    steps.native === 'success'
      ? missing.length === 0
        ? 'complete'
        : 'incomplete'
      : steps.native === 'failure' || steps.native === 'cancelled'
        ? 'native-failed'
        : steps.native === 'skipped'
          ? 'not-run'
          : 'incomplete';
  const upload = [FILES.manifest, FILES.result];
  if (parsed.state === 'valid') upload.push(FILES.observations);
  const result = {
    schema: SCHEMA,
    evidenceId: manifest.evidenceId,
    status,
    finalizedAt: now().toISOString(),
    steps,
    observations: {
      state: parsed.state,
      reason: parsed.reason,
      bytes: content?.length ?? 0,
      records: summary.records,
      closed: summary.closed,
      rejected: summary.rejected,
      omittedRecords: summary.omittedRecords,
      omittedBytes: summary.omittedBytes,
      byType: summary.byType,
    },
    cases: summary.cases,
    missing,
    uploaded: upload,
  };
  writeExclusive(
    join(directory, FILES.result),
    `${JSON.stringify(result, null, 2)}\n`,
    LIMITS.resultBytes,
  );
  const failed = status === 'incomplete' || parsed.state === 'rejected';
  return {
    status,
    result,
    upload: upload.map((name) => join(directory, name)),
    exitCode: failed ? 1 : 0,
  };
}

/** Append step outputs; multi-line values use a random delimiter. */
export function writeOutputs(file, values) {
  if (!file) return;
  let text = '';
  for (const [key, value] of Object.entries(values)) {
    if (value.includes('\n')) {
      const delimiter = `gg_evidence_${randomBytes(16).toString('hex')}`;
      text += `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
    } else text += `${key}=${value}\n`;
  }
  appendFileSync(file, text);
}

function summaryMarkdown(result) {
  const cases = Object.entries(result.cases)
    .map(([name, entry]) => `| ${name} | ${entry.result ?? 'not recorded'} | ${entry.children} |`)
    .join('\n');
  return [
    '## Windows launcher evidence',
    '',
    `Status: \`${result.status}\`. Native step: \`${result.steps.native}\`. ` +
      `Observations: \`${result.observations.state}\`, ${result.observations.records} records, ` +
      `${result.observations.bytes} bytes, ${result.observations.omittedRecords} omitted.`,
    `Missing required observations: ${result.missing.length === 0 ? 'none' : result.missing.join(', ')}.`,
    '',
    '| Case | Result | Child processes |',
    '| --- | --- | --- |',
    cases,
    '',
  ].join('\n');
}

/** CLI: `init` before the native step and `finalize` after it (always). Returns an exit code. */
export function main(
  argv,
  {
    env = process.env,
    repoRoot = defaultRoot,
    git,
    stdout = console.log,
    stderr = console.error,
  } = {},
) {
  const [command, ...rest] = argv;
  if (rest.length > 0 || (command !== 'init' && command !== 'finalize')) {
    stderr('Usage: windows-launcher-evidence.mjs init|finalize');
    return 2;
  }
  try {
    if (command === 'init') {
      const { directory, evidenceId } = initializeEvidence({
        env,
        repoRoot,
        ...(git ? { git } : {}),
      });
      stdout(
        JSON.stringify({ evidence: 'windows-launcher-export', state: 'initialized', evidenceId }),
      );
      // Written last: the step outputs exist only when `init` succeeds.
      writeOutputs(env.GITHUB_OUTPUT, { dir: directory, id: evidenceId });
      return 0;
    }
    const outcome = finalizeEvidence({ env, repoRoot });
    writeOutputs(env.GITHUB_OUTPUT, { status: outcome.status, paths: outcome.upload.join('\n') });
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, summaryMarkdown(outcome.result));
    stdout(
      JSON.stringify({
        evidence: 'windows-launcher-export',
        state: 'finalized',
        status: outcome.status,
        observations: outcome.result.observations.state,
        records: outcome.result.observations.records,
        missing: outcome.result.missing,
      }),
    );
    return outcome.exitCode;
  } catch (error) {
    const reason = error instanceof EvidenceRefusal ? error.reason : 'unavailable';
    stderr(`Windows launcher evidence ${command} refused: ${reason}.`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
