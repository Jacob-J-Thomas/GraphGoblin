import { join, resolve } from 'node:path';
import type { ImplementationTemplateSettings } from '@graphgoblin/contracts';
import { fail } from './protocol.js';
// The shipped entry emits one LF after the JSON.
export const SUPPORT_OUTPUT_BYTES = 65535;
/** Count serialized UTF-8, including JSON escapes, before any output-dependent effects. */
export function boundedSupportOutput<T>(value: T): T {
  if (Buffer.byteLength(JSON.stringify(value)) > SUPPORT_OUTPUT_BYTES)
    fail('SUPPORT_OUTPUT_TOO_LARGE');
  return value;
}
export function assertIssueOutput(
  settings: ImplementationTemplateSettings,
  issue: { number: number; title: string; body: string | null },
) {
  // Reserve the exact longest fixed identity fields before allocation. No criteria are truncated.
  const runId = '0'.repeat(26),
    attempt = 3;
  boundedSupportOutput({
    type: 'ImplementationWorkspace',
    repository: (settings.repository.owner + '/' + settings.repository.name).toLowerCase(),
    issue: issue.number,
    attempt,
    branch: 'graphgoblin/issue-' + issue.number + '-attempt-' + attempt,
    cwd: join(resolve(settings.repository.path), '.graphgoblin-worktrees', runId, 'issue'),
    title: issue.title,
    body: issue.body,
  });
}
