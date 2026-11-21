import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';

const execute = promisify(execFile);
const runCase = fileURLToPath(new URL('./fixtures/sdk-schema-case.mjs', import.meta.url));
const roots: string[] = [];
const schema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};
const modes = ['success', 'error', 'abort'] as const;
type Mode = (typeof modes)[number];
interface State {
  actualTemp: string;
  entriesBefore: string[];
  entriesAfter: string[];
  outcome: {
    kind: 'resolved' | 'rejected';
    finalResponse?: string;
    name?: string;
    message?: string;
  };
  record?: {
    pid: number;
    schemaPath: string;
    schemaDirectory: string;
    schemaText: string;
    schema: unknown;
    argv: string[];
  };
  schemaPresentAtAbort?: boolean;
  schemaDirectoryExistsAfter?: boolean;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    expect(relative(resolve(tmpdir()), root)).not.toMatch(/^\.\./);
    expect(basename(root)).toMatch(/^gg-sdk-schema-/);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function fixture(mode: Mode, length?: number) {
  const root = await mkdtemp(join(tmpdir(), 'gg-sdk-schema-'));
  roots.push(root);
  let temp = join(root, 'temp');
  if (length !== undefined) {
    while (temp.length + 42 < length) temp = join(temp, 'segment'.repeat(5));
    temp = join(temp, 'x'.repeat(length - temp.length - 1));
    expect(temp).toHaveLength(length);
  }
  const home = join(root, 'home');
  await Promise.all([mkdir(temp, { recursive: true }), mkdir(home)]);
  const unrelated = [join(temp, 'gg-schema-KEEP00'), join(temp, 'gg-structured-keep')];
  for (const directory of unrelated) {
    await mkdir(directory);
    await writeFile(join(directory, 'keep'), mode);
  }
  await writeFile(join(temp, 'unrelated.txt'), 'Keep this file');
  const stateFile = join(root, 'state.json');
  const configFile = join(root, 'case.json');
  await writeFile(
    configFile,
    JSON.stringify({
      mode,
      workingDirectory: root,
      schema,
      recordFile: join(root, 'schema-record.json'),
      stateFile,
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(
          entry[0],
        ),
    ),
  );
  const parentTemp = { TEMP: process.env['TEMP'], TMP: process.env['TMP'] };
  const output = await execute(process.execPath, [runCase, configFile], {
    cwd: root,
    env: {
      ...env,
      TEMP: temp,
      TMP: temp,
      TMPDIR: temp,
      CODEX_HOME: home,
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
    },
    windowsHide: true,
    timeout: 6000,
  });
  expect(output.stderr).toBe('');
  expect({ TEMP: process.env['TEMP'], TMP: process.env['TMP'] }).toEqual(parentTemp);
  const state = JSON.parse(await readFile(stateFile, 'utf8')) as State;
  expect(state.actualTemp).toBe(temp);
  for (const directory of unrelated)
    expect(await readFile(join(directory, 'keep'), 'utf8')).toBe(mode);
  expect(await readFile(join(temp, 'unrelated.txt'), 'utf8')).toBe('Keep this file');
  return { temp, state };
}

it.each(['short', '226-character'].flatMap((label) => modes.map((mode) => ({ label, mode }))))(
  '$label root $mode preserves the SDK schema contract and removes only its directory',
  async ({ label, mode }) => {
    const { temp, state } = await fixture(mode, label === 'short' ? undefined : 226);
    if (mode === 'success') {
      expect(state.outcome).toEqual({ kind: 'resolved', finalResponse: '{"ok":true}' });
    } else {
      expect(state.outcome.kind).toBe('rejected');
      if (mode === 'error')
        expect(state.outcome.message).toContain('Controlled schema fixture failure');
      else {
        expect(state.outcome.name).toBe('AbortError');
        expect(state.schemaPresentAtAbort).toBe(true);
      }
    }
    const record = state.record;
    expect(record, 'the real SDK must pass a readable schema to the harmless CLI').toBeDefined();
    if (!record) throw new Error('Expected the schema-reading CLI record');
    expect(record.argv).toContain('--output-schema');
    expect(record.schema).toEqual(schema);
    expect(record.schemaText).toBe(JSON.stringify(schema));
    expect(dirname(record.schemaDirectory)).toBe(temp);
    expect(basename(record.schemaDirectory)).toMatch(/^gg-schema-[A-Za-z0-9]{6}$/);
    expect(record.schemaPath).toBe(join(record.schemaDirectory, 'schema.json'));
    if (label === '226-character') {
      expect(record.schemaDirectory).toHaveLength(243);
      expect(record.schemaPath).toHaveLength(255);
    }
    expect(state.schemaDirectoryExistsAfter).toBe(false);
    const ownedNamespace = (names: string[]) =>
      names.filter((name) => name.startsWith('gg-schema-'));
    expect(ownedNamespace(state.entriesAfter)).toEqual(ownedNamespace(state.entriesBefore));
  },
  10_000,
);
