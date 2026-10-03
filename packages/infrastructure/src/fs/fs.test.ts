import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsArtifactStore } from './artifacts.js';
import { FsWorkspace } from './workspace.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'gg-fs-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('FsWorkspace', () => {
  it('resolves fixed, templated, and temporary directories and creates them', async () => {
    const ws = new FsWorkspace(dataDir);
    const fixed = await ws.resolve({ kind: 'fixed', path: join(dataDir, 'fixed') }, {}, 'run1');
    expect(statSync(fixed).isDirectory()).toBe(true);
    const templated = await ws.resolve(
      { kind: 'template', template: '{{ root }}/t/{{ name }}' },
      { root: dataDir, name: 'x' },
      'run1',
    );
    expect(templated.endsWith(join('t', 'x'))).toBe(true);
    expect(statSync(templated).isDirectory()).toBe(true);
    const temp = await ws.resolve({ kind: 'temp' }, {}, 'run1');
    expect(temp).toBe(join(dataDir, 'workspaces', 'run1'));
    expect(statSync(temp).isDirectory()).toBe(true);
    await expect(
      ws.resolve({ kind: 'template', template: '{{ missing }}' }, {}, 'run1'),
    ).rejects.toThrow(/empty path/);
  });

  it('writes relative and absolute files, creating parent directories', async () => {
    const ws = new FsWorkspace(dataDir);
    const dir = await ws.resolve({ kind: 'temp' }, {}, 'run2');
    const rel = await ws.writeFile(dir, 'out/nested/result.json', '{"a":1}');
    expect(rel).toBe(join(dir, 'out', 'nested', 'result.json'));
    expect(readFileSync(rel, 'utf8')).toBe('{"a":1}');
    const absTarget = join(dataDir, 'elsewhere', 'file.txt');
    const abs = await ws.writeFile(dir, absTarget, 'hi');
    expect(isAbsolute(abs)).toBe(true);
    expect(readFileSync(absTarget, 'utf8')).toBe('hi');
  });
});

describe('FsArtifactStore', () => {
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
