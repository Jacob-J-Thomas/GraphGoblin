import { createHash } from 'node:crypto';
import { lstat, open, realpath, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, parse, relative, resolve } from 'node:path';
import { qaDigest } from './qa-protocol.js';
import { contained } from './storage.js';
import {
  QaCriteriaSchema,
  QaResultsSchema,
  QaOriginalIssueSchema,
  QaProofSnapshotSchema,
  QaRelativePathSchema,
  validateQaCriteria,
  qaFail,
  qaScan,
  type QaIdentity,
  type QaScope,
  type QaProofSnapshot,
  type QaPacket,
} from './qa-protocol.js';
import { qaIdentityKey } from './qa-journal.js';

export const QA_FILE_BYTES = 262144;
export const QA_TOTAL_BYTES = 524288;
async function noLinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) qaFail('QA_PATH_LINK');
  }
}
export async function readQaRegularFile(
  root: string,
  path: string,
  maxBytes = QA_FILE_BYTES,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 1048576 ||
    !contained(root, path) ||
    resolve(root) === resolve(path)
  )
    qaFail('QA_PATH_OUTSIDE');
  await noLinks(root);
  await noLinks(path);
  if (!contained(await realpath(root), await realpath(path))) qaFail('QA_PATH_OUTSIDE');
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maxBytes))
    qaFail('QA_FILE_BOUND');
  const file = await open(path, 'r');
  try {
    const opened = await file.stat({ bigint: true });
    // Windows lstat reports dev=0 while handle.stat reports the volume id. File ids remain exact.
    if (
      !opened.isFile() ||
      (process.platform !== 'win32' && opened.dev !== before.dev) ||
      opened.ino !== before.ino ||
      opened.size > BigInt(maxBytes)
    )
      qaFail('QA_FILE_CHANGED');
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length <= maxBytes) {
      const read = await file.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    await noLinks(path);
    const after = await lstat(path, { bigint: true });
    if (
      length > maxBytes ||
      (process.platform !== 'win32' && after.dev !== opened.dev) ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs
    )
      qaFail('QA_FILE_CHANGED');
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export interface QaCollectRequest {
  identity: QaIdentity;
  round: number;
  artifactRoot: string;
  scope: QaScope;
  originalIssue: unknown;
  criteria: unknown;
  results: unknown;
  secrets: readonly string[];
}
export interface QaProofFiles {
  collect(request: QaCollectRequest): Promise<QaProofSnapshot>;
  evidence(
    snapshot: QaProofSnapshot,
    round: number,
  ): Promise<{ workspace: string; packet: QaPacket }>;
}
/** Reads only a trusted QA workspace root; copies only checked bytes to a separate support root. No cleanup. */
export class DiskQaProofFiles implements QaProofFiles {
  constructor(
    private readonly workspaceRoot: string,
    private readonly evidenceRoot: string,
    private readonly identity: QaIdentity,
    private readonly secrets: readonly string[] = [],
  ) {}
  async collect(request: QaCollectRequest): Promise<QaProofSnapshot> {
    if (
      qaIdentityKey(request.identity) !== qaIdentityKey(this.identity) ||
      !Number.isInteger(request.round) ||
      request.round < 0 ||
      request.round > 1 ||
      resolve(request.artifactRoot) !==
        resolve(
          join(this.workspaceRoot, this.identity.runId, 'round-' + request.round, 'artifacts'),
        )
    )
      qaFail('QA_PROOF_IDENTITY');
    const root = await realpath(this.workspaceRoot);
    await noLinks(this.workspaceRoot);
    await noLinks(request.artifactRoot);
    const artifactsRoot = await realpath(request.artifactRoot);
    if (!contained(root, artifactsRoot) || !(await lstat(artifactsRoot)).isDirectory())
      qaFail('QA_PATH_OUTSIDE');
    const criteria = validateQaCriteria(request.criteria, request.scope),
      results = QaResultsSchema.parse(request.results),
      originalIssue = QaOriginalIssueSchema.parse(request.originalIssue);
    if (
      originalIssue.number !== request.identity.issue ||
      results.results.length !== criteria.criteria.length ||
      new Set(results.results.map((row) => row.criterionId)).size !== results.results.length ||
      results.results.some(
        (row) => !criteria.criteria.some((criterion) => criterion.id === row.criterionId),
      )
    )
      qaFail('QA_PROOF_IDENTITY');
    const secrets = [...this.secrets, ...request.secrets];
    qaScan({ criteria, results, originalIssue }, secrets);
    const artifacts: QaPacket['artifacts'] = [],
      paths = new Map<string, string>();
    let total = 0;
    for (const row of results.results)
      for (const evidence of row.evidence) {
        const path = QaRelativePathSchema.parse(evidence.path);
        let target = paths.get(path);
        if (!target) {
          const bytes = await readQaRegularFile(artifactsRoot, join(artifactsRoot, path));
          if (!bytes.length || (total += bytes.length) > QA_TOTAL_BYTES) qaFail('QA_PROOF_BOUND');
          if (secrets.some((secret) => secret.length > 0 && bytes.includes(Buffer.from(secret))))
            qaFail('QA_SECRET_REFUSED');
          const sha256 = digest(bytes),
            id = qaDigest({ path, sha256 });
          target = 'artifacts/' + id + '.proof';
          paths.set(path, target);
          const text = bytes.toString('utf8'),
            encoding = Buffer.from(text).equals(bytes) && !text.includes('\0') ? 'utf8' : 'base64';
          artifacts.push({
            id,
            relativePath: target,
            sha256,
            encoding,
            content: encoding === 'utf8' ? text : bytes.toString('base64'),
          });
        }
        evidence.path = target;
      }
    const packet = {
      originalIssue,
      criteria: QaCriteriaSchema.parse(criteria),
      results,
      artifacts,
    };
    if (Buffer.byteLength(JSON.stringify(packet)) > 768000) qaFail('QA_PROOF_BOUND');
    return QaProofSnapshotSchema.parse({
      identity: request.identity,
      packet,
      digest: qaDigest({ identity: request.identity, packet }),
    });
  }
  async evidence(
    input: QaProofSnapshot,
    round: number,
  ): Promise<{ workspace: string; packet: QaPacket }> {
    const snapshot = QaProofSnapshotSchema.parse(input);
    if (
      qaIdentityKey(snapshot.identity) !== qaIdentityKey(this.identity) ||
      snapshot.digest !== qaDigest({ identity: snapshot.identity, packet: snapshot.packet }) ||
      !Number.isInteger(round) ||
      round < 0 ||
      round > 1
    )
      qaFail('QA_PROOF_IDENTITY');
    qaScan(snapshot.packet, this.secrets);
    const root = await realpath(this.evidenceRoot);
    await noLinks(this.evidenceRoot);
    if (contained(this.workspaceRoot, root) || contained(root, this.workspaceRoot))
      qaFail('QA_EVIDENCE_ROOT');
    const workspace = join(root, qaDigest({ identity: snapshot.identity, round }));
    const entries: [string, Buffer][] = [
      ['issue.json', Buffer.from(JSON.stringify(snapshot.packet.originalIssue))],
      ['criteria.json', Buffer.from(JSON.stringify(snapshot.packet.criteria))],
      ['results.json', Buffer.from(JSON.stringify(snapshot.packet.results))],
    ];
    for (const artifact of snapshot.packet.artifacts) {
      const bytes = Buffer.from(artifact.content, artifact.encoding === 'utf8' ? 'utf8' : 'base64');
      if (
        digest(bytes) !== artifact.sha256 ||
        !artifact.relativePath.startsWith('artifacts/') ||
        bytes.length > QA_FILE_BYTES ||
        this.secrets.some((secret) => secret.length > 0 && bytes.includes(Buffer.from(secret)))
      )
        qaFail('QA_PROOF_IDENTITY');
      entries.push([artifact.relativePath, bytes]);
    }
    if (new Set(entries.map(([path]) => path)).size !== entries.length) qaFail('QA_PROOF_IDENTITY');
    const manifest = Buffer.from(
      JSON.stringify({
        digest: snapshot.digest,
        files: entries.map(([path, bytes]) => ({ path, sha256: digest(bytes) })),
      }),
    );
    entries.push(['manifest.json', manifest]);
    try {
      await mkdir(workspace);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      await noLinks(workspace);
      for (const [path, bytes] of entries)
        if (!(await readQaRegularFile(workspace, join(workspace, path), 1048576)).equals(bytes))
          qaFail('QA_EVIDENCE_CHANGED');
      const actual = await readdir(workspace, { recursive: true, withFileTypes: true });
      const files = actual.filter((entry) => entry.isFile());
      if (
        files.length !== entries.length ||
        actual.some((entry) => entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
      )
        qaFail('QA_EVIDENCE_CHANGED');
      return { workspace, packet: snapshot.packet };
    }
    for (const [path, bytes] of entries) {
      const target = join(workspace, path);
      if (!contained(workspace, target)) qaFail('QA_PATH_OUTSIDE');
      await mkdir(dirname(target), { recursive: true });
      await noLinks(dirname(target));
      const file = await open(target, 'wx');
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
    }
    return { workspace, packet: snapshot.packet };
  }
}
