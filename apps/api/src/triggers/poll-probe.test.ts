import { describe, expect, it } from 'vitest';
import type { ScriptRunResult } from '@graphgoblin/engine';
import { itemsScriptProbe, itemsHttpProbe } from './poll-probe.js';
const result: ScriptRunResult = {
  exitCode: 0,
  stdout: '[{"number":7}]',
  stderr: 'private process detail',
  stdoutBytes: 14,
  stderrBytes: 22,
  timedOut: false,
  stdoutOverflow: false,
  stderrOverflow: false,
};
describe('items-only strict probe admission', () => {
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
