import { describe, expect, it } from 'vitest';
import { PROBE_MAX_BODY_BYTES, type ScriptRunResult } from '@graphgoblin/engine';
import { itemsScriptProbe, itemsHttpProbe } from './poll-probe.js';
const result: ScriptRunResult = {
  exitCode: 0,
  stdout: '[{"number":7}]',
  stderr: 'private process detail',
  stdoutBytes: 14,
  stderrBytes: 22,
  state: 'completed' as const,
  timedOut: false,
  stdoutOverflow: false,
  stderrOverflow: false,
};
describe('items-only strict probe admission', () => {
  it('passes deeply nested valid probe JSON to candidate classification without a stack overflow', () => {
    const stdout = '['.repeat(15000) + '1' + ']'.repeat(15000);
    expect(itemsScriptProbe({ ...result, stdout, stdoutBytes: stdout.length })).toHaveProperty(
      'json',
    );
    expect(itemsHttpProbe({ status: 200, headers: {}, body: stdout })).toHaveProperty('json');
    const json: unknown = JSON.parse(stdout);
    expect(itemsHttpProbe({ status: 200, headers: {}, body: '', json })).toHaveProperty(
      'json',
      json,
    );
  });
  it('accepts complete JSON without persisting process diagnostics', () => {
    expect(itemsScriptProbe(result)).toEqual({
      exitCode: 0,
      stdout: result.stdout,
      stderr: '',
      json: [{ number: 7 }],
      timedOut: false,
    });
  });
  it('rejects failures, timeouts, overflows and invalid JSON with fixed codes', () => {
    for (const [change, code] of [
      [{ exitCode: 1 }, 'POLL_PROBE_FAILED'],
      [{ exitCode: null }, 'POLL_PROBE_FAILED'],
      [{ timedOut: true }, 'POLL_PROBE_TIMED_OUT'],
      [{ stdoutOverflow: true }, 'POLL_STDOUT_OVERFLOW'],
      [{ stdout: 'private invalid json' }, 'POLL_JSON_INVALID'],
      [{ stdout: '1e999' }, 'POLL_JSON_INVALID'],
    ] as const) {
      const output = { ...result, ...change };
      output.stdoutBytes = new TextEncoder().encode(output.stdout).byteLength;
      expect(() => itemsScriptProbe(output)).toThrow(code);
    }
  });
  it('accepts script stdout at the exact raw-byte cap', () => {
    const stdout = JSON.stringify('x'.repeat(PROBE_MAX_BODY_BYTES - 2));
    const stdoutBytes = new TextEncoder().encode(stdout).byteLength;
    expect(stdoutBytes).toBe(PROBE_MAX_BODY_BYTES);
    expect(itemsScriptProbe({ ...result, stdout, stdoutBytes })).toMatchObject({ stdout });
  });
  it('rejects 65,537 raw stdout bytes even when the overflow flag is false', () => {
    const stdout = JSON.stringify('x'.repeat(PROBE_MAX_BODY_BYTES - 1));
    const stdoutBytes = new TextEncoder().encode(stdout).byteLength;
    expect(stdoutBytes).toBe(65_537);
    expect(() =>
      itemsScriptProbe({ ...result, stdout, stdoutBytes, stdoutOverflow: false }),
    ).toThrow('POLL_STDOUT_OVERFLOW');
  });
  it('accepts provided or parsed HTTP JSON and rejects bad statuses or non-JSON responses', () => {
    expect(itemsHttpProbe({ status: 200, headers: {}, body: '[1]' })).toMatchObject({ json: [1] });
    expect(
      itemsHttpProbe({
        status: 200,
        headers: {},
        body: '{"success":false,"error":"user fields"}',
      }),
    ).toMatchObject({ json: { success: false, error: 'user fields' } });
    expect(itemsHttpProbe({ status: 200, headers: {}, body: '', json: [2] })).toMatchObject({
      json: [2],
    });
    expect(() =>
      itemsHttpProbe({ status: 503, headers: {}, body: 'private remote detail' }),
    ).toThrow('POLL_PROBE_FAILED');
    expect(() =>
      itemsHttpProbe({ status: 200, headers: {}, body: 'private invalid JSON' }),
    ).toThrow('POLL_JSON_INVALID');
    expect(() => itemsHttpProbe({ status: 200, headers: {}, body: '', json: Infinity })).toThrow(
      'POLL_JSON_INVALID',
    );
  });
});
