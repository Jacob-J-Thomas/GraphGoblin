import { describe, expect, it } from 'vitest';
import { CLAUDE_RECOVERY_HINT, claudeDiagnosticName, protocolError } from './errors.js';

describe('safe Claude diagnostic names', () => {
  it('retains real record, plugin, skill and tool names', () => {
    for (const name of [
      'system',
      'ui_invalidate',
      'ui.render',
      'cc-plugin-agents-md',
      'cc-plugin-plugin-authoring',
      'plugin-authoring',
      'StructuredOutput',
    ])
      expect(claudeDiagnosticName(name)).toBe(name);
  });

  it.each([
    'C:/Users/alice/secret.txt',
    'home/alice/notes.md',
    'alice@example.com',
    'C:\\Users\\alice\\secret.txt',
    'account:alice',
  ])('redacts path/account-like metadata %s from diagnostics', (value) => {
    expect(claudeDiagnosticName(value)).toBe('<invalid>');
    expect(protocolError({ type: value, subtype: value, body: 'PRIVATE_BODY' })).toMatchObject({
      code: 'HARNESS_PROTOCOL_ERROR',
      message: `Claude stream protocol is invalid or incomplete (record <invalid>/<invalid>). ${CLAUDE_RECOVERY_HINT}`,
    });
  });
});
