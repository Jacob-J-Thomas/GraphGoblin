import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openOutputMetadataCheck } from './plugin-output-metadata.mjs';

vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }));

describe('bounded Windows stream inspection protocol', () => {
  const entry = { path: resolve("owner's [literal] $& 漢", 'SKILL.md'), directory: false };

  beforeEach(() => {
    vi.stubEnv('SystemRoot', resolve('system'));
  });
  afterEach(() => vi.unstubAllEnvs());

  function fakeChild(replies, finishCode = 0, trailing = '') {
    const process = new EventEmitter();
    const requests = [];
    process.exitCode = null;
    process.signalCode = null;
    process.stdout = new PassThrough();
    process.stdin = new Writable({
      write(chunk, _encoding, acknowledge) {
        requests.push(JSON.parse(chunk.toString()));
        for (const message of replies.shift()) process.stdout.write(message);
        acknowledge();
      },
      final(acknowledge) {
        process.stdout.end(trailing);
        acknowledge();
        process.exitCode = finishCode;
        process.emit('close', finishCode);
      },
    });
    process.kill = () => {
      process.signalCode = 'SIGKILL';
      process.stdout.end();
      process.emit('close', null);
    };
    spawn.mockReturnValueOnce(process);
    return { process, requests };
  }

  it('sends two literal pathname batches to one process and requires clean final EOF', async () => {
    const { requests } = fakeChild([['o', 'k\r\n'], ['ok\n']]);
    const helper = await openOutputMetadataCheck('win32');
    await helper.check([entry]);
    await helper.check([{ ...entry, directory: true }]);
    await helper.finish();
    await helper.close();
    expect(requests).toHaveLength(2);
    expect(requests[0][0]).toMatchObject({
      directory: false,
      path: expect.stringContaining(entry.path),
    });
    expect(requests[1][0].directory).toBe(true);
    const [, args, options] = spawn.mock.calls.at(-1);
    expect(args).toContain('-EncodedCommand');
    expect(args.join(' ')).not.toContain(entry.path);
    expect(options).toMatchObject({ windowsHide: true });
    expect(Object.keys(options.env).sort()).toEqual(['SystemRoot', 'TEMP', 'TMP']);
  });

  it.each([
    ['foreign:0\n', /alternate data stream found/],
    ['error:0:5\n', /platform error 5/],
    ['foreign:1\n', /invalid response/],
    ['unexpected\n', /invalid response/],
    ['ok\nanother\n', /invalid response/],
    ['x'.repeat(100), /response is too long/],
  ])('rejects a non-clean reply %j', async (reply, expected) => {
    fakeChild([[reply]]);
    const helper = await openOutputMetadataCheck('win32');
    await expect(helper.check([entry])).rejects.toThrow(expected);
    await helper.close();
  });

  it.each([
    [1, ''],
    [0, 'extra'],
  ])('rejects a failed or nonempty final EOF', async (code, extra) => {
    fakeChild([['ok\n']], code, extra);
    const helper = await openOutputMetadataCheck('win32');
    await helper.check([entry]);
    await expect(helper.finish()).rejects.toThrow(/did not finish successfully/);
    await helper.close();
  });

  it('fails if the Windows helper is unavailable or interrupted', async () => {
    const { process } = fakeChild([[]]);
    const helper = await openOutputMetadataCheck('win32');
    process.emit('error', new Error('fixture process launch refusal'));
    process.kill();
    await expect(helper.check([entry])).rejects.toThrow(/without a response/);
    await helper.close();
  });

  it('closes its own pipes and rejects on deadline without waiting for inherited pipe handles', async () => {
    vi.useFakeTimers();
    try {
      const { process } = fakeChild([[]]);
      process.kill = vi.fn(() => process.emit('exit', null));
      const helper = await openOutputMetadataCheck('win32');
      const checked = expect(helper.check([entry])).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(15_000);
      await checked;
      await helper.close();
      expect(process.kill).toHaveBeenCalledWith('SIGKILL');
      expect(process.stdin.destroyed).toBe(true);
      expect(process.stdout.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('limits the request before writing it and fails with no SystemRoot', async () => {
    const { requests } = fakeChild([]);
    const helper = await openOutputMetadataCheck('win32');
    await expect(helper.check([{ ...entry, path: 'x'.repeat(1024 * 1024) }])).rejects.toThrow(
      /too large/,
    );
    expect(requests).toEqual([]);
    await helper.close();
    vi.stubEnv('SystemRoot', undefined);
    await expect(openOutputMetadataCheck('win32')).rejects.toThrow(/SystemRoot is unavailable/);
  });

  it('launches isolated Linux Python with a literal Unicode path in UTF-8 stdin', async () => {
    const { requests } = fakeChild([['ok\n'], ['foreign:0\n']]);
    const helper = await openOutputMetadataCheck('linux');
    await helper.check([entry]);
    await expect(helper.check([entry])).rejects.toThrow(/Unowned extended attribute/);
    await helper.close();
    const [binary, args, options] = spawn.mock.calls.at(-1);
    expect(binary).toBe('/usr/bin/python3');
    expect(args.slice(0, 5)).toEqual(['-I', '-S', '-X', 'utf8', '-c']);
    expect(options.env).toEqual({});
    expect(requests).toEqual([[entry], [entry]]);
  });

  it('checks macOS attribute names with an absolute literal argument and rejects any result', async () => {
    const helper = await openOutputMetadataCheck('darwin');
    execFile.mockImplementationOnce((_program, _args, _options, cb) => cb(null, '', ''));
    await helper.check([entry]);
    const [program, args, options] = execFile.mock.calls.at(-1);
    expect(program).toBe('/usr/bin/xattr');
    expect(args).toEqual(['-s', entry.path]);
    expect(options).toMatchObject({ env: {}, timeout: 3_000, maxBuffer: 64 * 1024 });
    await helper.finish();
    await helper.close();
    for (const [error, stdout, stderr, explanation] of [
      [null, 'name\n', '', /Unowned extended attribute/],
      [null, '', 'incomplete', /inspection failed/],
      [new Error('fixture'), '', '', /Cannot inspect/],
    ]) {
      execFile.mockImplementationOnce((_program, _args, _options, cb) => cb(error, stdout, stderr));
      await expect(helper.check([entry])).rejects.toThrow(explanation);
    }
    await expect(openOutputMetadataCheck('unknown')).rejects.toThrow(/unavailable/);
  });
});
