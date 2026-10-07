import {
  claudePolicyIssues,
  HarnessOptionsSchema,
  CapabilitiesSchema,
  type Capabilities,
  type Effort,
  type HarnessOptions,
  type ClaudePolicy as ContractClaudePolicy,
} from '@graphgoblin/contracts';
import { claudeModelCapabilities, CLAUDE_BILLING_UNVERIFIED_MESSAGE } from './models.js';
export { CLAUDE_MODEL } from './models.js';
import { ClaudeHarnessError } from './errors.js';
export type ClaudePolicy = ContractClaudePolicy;
const unsupported = (message: string): never => {
  throw new ClaudeHarnessError('HARNESS_UNSUPPORTED_POLICY', message);
};
/** Initial native-Windows policy: no filesystem/OS sandbox, no prompt approvals or custom capabilities. */
export function claudePolicy(
  options: HarnessOptions,
  capabilities?: Capabilities,
  platform: NodeJS.Platform = process.platform,
): ClaudePolicy {
  if (platform !== 'win32') unsupported('Claude policy is verified only on native Windows');
  const parsedOptions = HarnessOptionsSchema.safeParse(options);
  const parsedCapabilities = CapabilitiesSchema.optional().safeParse(capabilities);
  if (!parsedOptions.success) return unsupported('Claude policy configuration is invalid');
  if (!parsedCapabilities.success) return unsupported('Claude policy configuration is invalid');
  const issue = claudePolicyIssues(parsedOptions.data, parsedCapabilities.data)[0];
  if (issue) unsupported(issue.message);
  const readOnly = options.sandbox === 'read-only';
  return {
    sandbox: readOnly ? 'read-only' : 'danger-full-access',
    approval: 'never',
    permissionMode: 'dontAsk',
    tools: readOnly ? ['Read', 'Glob', 'Grep'] : ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
    authMethod: 'claude.ai',
    billingMode: 'claude.ai-account',
    billingStatus: 'account-dependent',
    boundary: readOnly ? 'builtin-tools' : 'unconfined',
    network: 'unconfined',
  };
}
export const SUPPRESSION_ARGS = [
  '--safe-mode',
  '--setting-sources',
  '',
  '--strict-mcp-config',
] as const;
export function policyArgs(policy: ClaudePolicy): string[] {
  return [
    ...SUPPRESSION_ARGS,
    ...(policy.sandbox === 'read-only' ? ['--restricted'] : []),
    '--tools',
    policy.tools.join(','),
    '--permission-mode',
    'dontAsk',
    ...(policy.sandbox === 'danger-full-access'
      ? [
          '--allowedTools',
          policy.tools.map((tool) => (tool === 'Bash' ? 'Bash(*)' : tool)).join(','),
        ]
      : []),
    '--permission-prompts',
    'none',
  ];
}
/** Validate already resolved settings; inheritance belongs exclusively to the shared engine resolver. */
export function resolvedClaudeSettings(input: { model?: string; effort?: Effort }): {
  model: string;
  effort: Effort;
} {
  const { model, effort } = input;
  const entry = claudeModelCapabilities().find((entry) => entry.model === model);
  if (!entry)
    throw new ClaudeHarnessError(
      'HARNESS_INVALID_CONFIGURATION',
      'Claude model must be the explicit supported catalog model',
    );
  if (entry.admission === 'blocked')
    throw new ClaudeHarnessError('HARNESS_MODEL_UNVERIFIED', CLAUDE_BILLING_UNVERIFIED_MESSAGE);
  if (effort === undefined || !entry.efforts.includes(effort))
    throw new ClaudeHarnessError('HARNESS_INVALID_CONFIGURATION', 'Claude effort is unsupported');
  return { model: entry.model, effort };
}
