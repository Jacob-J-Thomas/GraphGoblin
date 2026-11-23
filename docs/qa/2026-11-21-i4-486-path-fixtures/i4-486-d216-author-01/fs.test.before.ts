import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { WorkingDirectorySpec } from '@graphgoblin/contracts';
import { TemplateError } from '@graphgoblin/domain';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { FsArtifactStore } from './artifacts.js';
import { FsWorkspace } from './workspace.js';
import {
  OwnedRunResources,
  type OwnedRunResource,
  type RunResourceJournal,
} from './owned-resources.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'gg-wp-e3-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function createRelativeWorkspaceTarget(): string {
  const fixtureDir = mkdtempSync(join(process.cwd(), 'gg-wp-relative-'));
  onTestFinished(() => rmSync(fixtureDir, { recursive: true, force: true }));
  return join(fixtureDir, 'workspace');
}

describe('FsWorkspace', () => {
  it('resolves fixed, relative, and temporary directories and reuses them', async () => {
    const ws = new FsWorkspace(dataDir);
    const fixed = await ws.resolve({ kind: 'fixed', path: join(dataDir, 'fixed') }, 'run1');
    expect(statSync(fixed).isDirectory()).toBe(true);
    expect(await ws.resolve({ kind: 'fixed', path: fixed }, 'run2')).toBe(fixed);
    const relativePath = relative(process.cwd(), createRelativeWorkspaceTarget());
    expect(isAbsolute(relativePath)).toBe(false);
    const relativeDirectory = await ws.resolve({ kind: 'fixed', path: relativePath }, 'run1');
    expect(relativeDirectory).toBe(resolve(relativePath));
    expect(statSync(relativeDirectory).isDirectory()).toBe(true);
    const temp = await ws.resolve({ kind: 'temp' }, 'run1');
    expect(temp).toBe(join(dataDir, 'workspaces', 'run1'));
    expect(statSync(temp).isDirectory()).toBe(true);
    expect(await ws.resolve({ kind: 'temp' }, 'run1')).toBe(temp);
  });

  it('writes relative and absolute files, creating parent directories', async () => {
    const ws = new FsWorkspace(dataDir);
    const dir = await ws.resolve({ kind: 'temp' }, 'run2');
    const rel = await ws.writeFile(dir, 'out/nested/result.json', '{"a":1}');
    expect(rel).toBe(join(dir, 'out', 'nested', 'result.json'));
    expect(readFileSync(rel, 'utf8')).toBe('{"a":1}');
    const absTarget = join(dataDir, 'elsewhere', 'file.txt');
    const abs = await ws.writeFile(dir, absTarget, 'hi');
    expect(isAbsolute(abs)).toBe(true);
    expect(readFileSync(absTarget, 'utf8')).toBe('hi');
  });

  it('propagates mkdir failures and succeeds after the external path is repaired', async () => {
    const blocker = join(dataDir, 'blocker');
    writeFileSync(blocker, 'blocks a directory');
    const ws = new FsWorkspace(dataDir);
    const spec = { kind: 'fixed', path: join(blocker, 'child') } as const;
    await expect(ws.resolve(spec, 'run')).rejects.toThrow();
    expect(readFileSync(blocker, 'utf8')).toBe('blocks a directory');
    rmSync(blocker);
    expect(await ws.resolve(spec, 'run')).toBe(spec.path);
    expect(statSync(spec.path).isDirectory()).toBe(true);
  });
});

describe('engine workspace filesystem boundary', () => {
  // RunManager and the workspace are real; script execution and the journal are controlled ports.
  it.each(['fixed', 'relative', 'temp', 'template'] as const)(
    'uses real %s paths, caches resolution for delivery, and claims only new temporary directories',
    async (kind) => {
      const target =
        kind === 'relative' ? createRelativeWorkspaceTarget() : join(dataDir, 'user-owned');
      const fixedPath = kind === 'relative' ? relative(process.cwd(), target) : target;
      if (kind === 'relative') expect(isAbsolute(fixedPath)).toBe(false);
      const claims: OwnedRunResource[] = [];
      const journal: RunResourceJournal = {
        find: () => Promise.resolve(undefined),
        claim: vi.fn((resource) => {
          claims.push(resource);
          return Promise.resolve();
        }),
        use: vi.fn(() => Promise.resolve()),
      };
      const resources = new OwnedRunResources(dataDir, journal);
      const engine = await createTestEngine();
      const port = vi
        .spyOn(engine.ports.workspace, 'resolve')
        .mockImplementation(resources.workspace.resolve);
      vi.spyOn(engine.ports.workspace, 'writeFile').mockImplementation(
        resources.workspace.writeFile,
      );
      const spec: WorkingDirectorySpec =
        kind === 'temp'
          ? { kind: 'temp' }
          : kind === 'template'
            ? { kind: 'template', template: '\t {{trigger.payload.path}}\r\n' }
            : { kind: 'fixed', path: fixedPath };
      const loop = singleNodeLoop(
        `real workspace ${kind}`,
        {
          id: 'script',
          kind: 'script',
          label: 'Script',
          config: { command: 'controlled-script', cwd: 'workspace' },
        },
        {
          returns: '"real file bytes"',
          destinations: [{ kind: 'file', path: 'nested/result.txt', format: 'text' }],
        },
      );
      loop.settings = { workingDirectory: spec };
      try {
        const run = await engine.runToIdle(engine.publish(loop).loopId, { path: target });
        const path = kind === 'temp' ? join(realpathSync(dataDir), 'workspaces', run.id) : target;
        expect(run.status).toBe('succeeded');
        expect(port).toHaveBeenCalledTimes(1);
        expect(port).toHaveBeenCalledWith(
          kind === 'temp' ? { kind: 'temp' } : { kind: 'fixed', path: fixedPath },
          run.id,
        );
        expect(engine.ports.scripts.calls[0]?.cwd).toBe(path);
        expect(readFileSync(join(path, 'nested/result.txt'), 'utf8')).toBe('real file bytes');
        const actual = realpathSync(path);
        const canonical = process.platform === 'win32' ? actual.toLowerCase() : actual;
        expect(journal.use).toHaveBeenCalledExactlyOnceWith(
          run.id,
          `workspace:${canonical}`,
          canonical,
        );
        expect(claims).toHaveLength(kind === 'temp' ? 1 : 0);
        if (kind === 'temp') {
          expect(claims[0]).toMatchObject({ ownerRunId: run.id, kind: 'workspace', path });
          expect(claims[0]?.identity).toEqual(expect.any(String));
          expect(await resources.workspace.resolve({ kind: 'temp' }, run.id)).toBe(path);
          expect(claims).toHaveLength(1);
        }
      } finally {
        engine.manager.stop();
      }
    },
  );

  it.each([
    '\t {{vars.missing}}\n',
    'private-marker\n{% invalid_private %}',
    '{% include "private-marker" %}',
  ])(
    'rejects an invalid engine template with zero resolve, mkdir and journal effects (%#)',
    async (template) => {
      const journal: RunResourceJournal = {
        find: vi.fn(() => Promise.resolve(undefined)),
        claim: vi.fn(() => Promise.resolve()),
        use: vi.fn(() => Promise.resolve()),
      };
      const resources = new OwnedRunResources(dataDir, journal);
      const engine = await createTestEngine();
      const port = vi
        .spyOn(engine.ports.workspace, 'resolve')
        .mockImplementation(resources.workspace.resolve);
      const loop = singleNodeLoop('reject before fs', {
        id: 'script',
        kind: 'script',
        label: 'Script',
        config: { command: 'controlled-script', cwd: 'workspace' },
      });
      loop.settings = { workingDirectory: { kind: 'template', template } };
      try {
        const run = await engine.runToIdle(engine.publish(loop).loopId);
        expect(run.failure).toMatchObject({
          code: 'TEMPLATE_ERROR',
          nodeId: 'script',
          resumable: false,
          details: { boundary: 'settings.workingDirectory.template' },
        });
        await expect(engine.manager.resume(run.id)).rejects.toMatchObject({
          code: 'FAILURE_NOT_RESUMABLE',
        });
        expect(port).not.toHaveBeenCalled();
        expect(engine.ports.scripts.calls).toEqual([]);
        expect(readdirSync(dataDir)).toEqual([]);
        expect(journal.claim).not.toHaveBeenCalled();
        expect(journal.use).not.toHaveBeenCalled();
        expect(journal.find).not.toHaveBeenCalled();
      } finally {
        engine.manager.stop();
      }
    },
  );

  it('keeps a journal rejection external after mkdir and does not cache the failed resolution', async () => {
    const fault = new TemplateError('private-journal-marker');
    const journal: RunResourceJournal = {
      find: () => Promise.resolve(undefined),
      claim: vi.fn(() => Promise.resolve()),
      use: vi.fn(() => Promise.resolve()).mockRejectedValueOnce(fault),
    };
    const resources = new OwnedRunResources(dataDir, journal);
    const engine = await createTestEngine();
    const port = vi
      .spyOn(engine.ports.workspace, 'resolve')
      .mockImplementation(resources.workspace.resolve);
    const loop = singleNodeLoop('journal repair', {
      id: 'script',
      kind: 'script',
      label: 'Script',
      config: { command: 'controlled-script', cwd: 'workspace' },
    });
    const target = join(dataDir, 'created-before-journal-fault');
    loop.settings = {
      workingDirectory: { kind: 'template', template: ' {{trigger.payload.path}} ' },
    };
    try {
      const run = await engine.runToIdle(engine.publish(loop).loopId, { path: target });
      expect(run.failure).toMatchObject({
        code: 'INTERNAL_ERROR',
        nodeId: 'script',
        resumable: true,
      });
      expect(JSON.stringify(run.failure)).not.toContain('private-journal-marker');
      expect(run.failure?.details).toBeUndefined();
      expect(existsSync(target)).toBe(true);
      expect(engine.ports.scripts.calls).toEqual([]);
      expect(journal.claim).not.toHaveBeenCalled();
      await engine.manager.resume(run.id);
      expect((await engine.settle(run.id)).status).toBe('succeeded');
      expect(port).toHaveBeenCalledTimes(2);
      expect(journal.use).toHaveBeenCalledTimes(2);
      expect(engine.ports.scripts.calls[0]?.cwd).toBe(target);
    } finally {
      engine.manager.stop();
    }
  });
});

describe('FsArtifactStore', () => {
  // POSIX permits replacement while the destination is open; this exercises Windows sharing.
  it.skipIf(process.platform !== 'win32')(
    'accepts verified bytes published by another writer while a read handle blocks replacement',
    async () => {
      const content = 'x'.repeat(32 * 1024 * 1024);
      const bytes = Buffer.from(content);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const ref = `artifact:transcript/${hash}`;
      const dir = join(dataDir, 'artifacts', 'transcript');
      const final = join(dir, hash);
      mkdirSync(dir, { recursive: true });
      let readHandle: number | undefined;
      let injected = false;
      let setupError: unknown;
      const observer = watch(dir, (_event, name) => {
        if (injected || !name?.startsWith(`.${hash}.`) || !name.endsWith('.tmp')) return;
        injected = true;
        try {
          // A .tmp proves put already checked the missing destination. Synchronous setup keeps
          // this callback ahead of put's remaining asynchronous write/fsync/rename continuations.
          statSync(join(dir, name));
          writeFileSync(final, bytes);
          readHandle = openSync(final, 'r');
        } catch (error) {
          setupError = error;
        }
      });
      const store = new FsArtifactStore(dataDir);
      try {
        await expect(store.put('transcript', content)).resolves.toEqual({
          ref,
          bytes: bytes.length,
        });
        expect(injected).toBe(true);
        expect(setupError).toBeUndefined();
        expect(readHandle).toBeDefined();
        expect(await store.get(ref)).toBe(content);
        expect(readFileSync(final).equals(bytes)).toBe(true);
        expect(readdirSync(dir)).toEqual([hash]);
      } finally {
        observer.close();
        if (readHandle !== undefined) closeSync(readHandle);
      }
    },
  );

  it('rejects corrupted final bytes and atomically repairs a pre-existing partial file', async () => {
    const store = new FsArtifactStore(dataDir);
    const content = 'complete transcript: 世界 🧙';
    const hash = createHash('sha256').update(content).digest('hex');
    const dir = join(dataDir, 'artifacts', 'transcript');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, hash), 'complete');
    const ref = `artifact:transcript/${hash}`;
    await expect(store.get(ref)).rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT', ref });
    const repaired = await store.put('transcript', content);
    expect(repaired.ref).toBe(ref);
    expect(readFileSync(join(dir, hash)).equals(Buffer.from(content))).toBe(true);
    expect(await store.get(ref)).toBe(content);
    expect(readdirSync(dir)).toEqual([hash]);
  });

  it('does not accept truncated bytes on a repeated put', async () => {
    const store = new FsArtifactStore(dataDir);
    const { ref } = await store.put('transcript', 'a complete transcript');
    const hash = ref.split('/')[1]!;
    writeFileSync(join(dataDir, 'artifacts', 'transcript', hash), 'a');
    expect(await store.put('transcript', 'a complete transcript')).toMatchObject({ ref });
    expect(await store.get(ref)).toBe('a complete transcript');
  });

  it('ignores interrupted temporary writes and converges under identical and different concurrent puts', async () => {
    const store = new FsArtifactStore(dataDir);
    const dir = join(dataDir, 'artifacts', 'transcript');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.interrupted.tmp'), 'partial');
    const contents = ['', '世界 🧙\u0000\r\n'.repeat(200_000), 'other content'];
    const stored = await Promise.all(
      contents.flatMap((content) => [
        store.put('transcript', content),
        new FsArtifactStore(dataDir).put('transcript', content),
      ]),
    );
    for (const [i, content] of contents.entries()) {
      const a = stored[i * 2]!;
      expect(stored[i * 2 + 1]).toEqual(a);
      expect(a.bytes).toBe(Buffer.byteLength(content));
      expect(await store.get(a.ref)).toBe(content);
      expect(await store.get(a.ref.toUpperCase())).toBeUndefined();
      expect(readFileSync(join(dir, a.ref.split('/')[1]!)).equals(Buffer.from(content))).toBe(true);
    }
    expect(new Set(stored.map((item) => item.ref)).size).toBe(contents.length);
    expect(readdirSync(dir).sort()).toEqual(
      [
        '.interrupted.tmp',
        ...stored.filter((_, i) => i % 2 === 0).map((item) => item.ref.split('/')[1]!),
      ].sort(),
    );
  });

  it('stores content once by hash and reads it back by reference', async () => {
    const store = new FsArtifactStore(dataDir);
    const first = await store.put('transcript', 'hello world');
    const second = await store.put('Transcript', 'hello world');
    expect(first.ref).toBe(second.ref);
    expect(first.ref).toMatch(/^artifact:transcript\/[a-f0-9]{64}$/);
    expect(first.bytes).toBe(11);
    expect(await store.get(first.ref)).toBe('hello world');
    const weird = await store.put('kind with spaces/and slashes', 'x');
    expect(weird.ref.startsWith('artifact:kind_with_spaces_and_slashes/')).toBe(true);
    const empty = await store.put('', 'y');
    expect(empty.ref.startsWith('artifact:blob/')).toBe(true);
  });

  it('verifies raw bytes before UTF-8 decoding', async () => {
    const store = new FsArtifactStore(dataDir);
    const { ref } = await store.put('text', '\ufffd');
    const hash = ref.split('/')[1]!;
    writeFileSync(join(dataDir, 'artifacts', 'text', hash), Buffer.from([0xff]));
    await expect(store.get(ref)).rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' });
  });

  it('reports a typed publication failure without a final artifact when storage is unavailable', async () => {
    const store = new FsArtifactStore(dataDir);
    writeFileSync(join(dataDir, 'artifacts'), 'a file blocks the artifact directory');
    await expect(store.put('transcript', 'complete')).rejects.toMatchObject({
      code: 'ARTIFACT_WRITE_FAILED',
    });
  });

  it('returns undefined for malformed or missing references', async () => {
    const store = new FsArtifactStore(dataDir);
    expect(await store.get('nope')).toBeUndefined();
    expect(await store.get('artifact:transcript/../../etc/passwd')).toBeUndefined();
    expect(await store.get(`artifact:transcript/${'a'.repeat(64)}`)).toBeUndefined();
  });

  it('rethrows unexpected filesystem errors', async () => {
    const store = new FsArtifactStore(dataDir);
    const { ref } = await store.put('kind', 'content');
    const hash = ref.split('/')[1] as string;
    // Make the expected file path a directory so reading it fails with something other than ENOENT.
    rmSync(join(dataDir, 'artifacts', 'kind', hash));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dataDir, 'artifacts', 'kind', hash));
    await expect(store.get(ref)).rejects.toThrow();
  });
});
