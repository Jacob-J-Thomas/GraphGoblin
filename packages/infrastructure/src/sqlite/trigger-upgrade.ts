import { createHash } from 'node:crypto';
import { WebhookConfigSchema } from '@graphgoblin/contracts';
import type { UpgradeIssue } from '@graphgoblin/domain';

type Row = Record<string, unknown>;
export interface TriggerUpgradeFacts {
  issues: UpgradeIssue[];
  keys: { inboundId: string; previous: string; next: string; runIds: string[] }[];
}
const object = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const storedJson = (value: unknown): unknown =>
  typeof value === 'string' ? JSON.parse(value) : value;
/** Exact endpoint/version provenance only. Prefix-looking authored business keys are untouched. */
export function inspectTriggerUpgrade(stored: Record<string, Row[]>): TriggerUpgradeFacts {
  const issues: UpgradeIssue[] = [];
  const keys: TriggerUpgradeFacts['keys'] = [];
  const configs = new Map<string, ReturnType<typeof WebhookConfigSchema.parse>>();
  const retired = new Set<string>();
  const refuse = (path: string, message: string) =>
    issues.push({ code: 'UPGRADE_WEBHOOK_PROVENANCE_REFUSED', path, message });
  for (const endpoint of stored.webhook_endpoints ?? []) {
    const path = '/webhook_endpoints/' + String(endpoint.id);
    try {
      // Ordinary deletion removes loop and versions but preserves disabled endpoint history.
      // No execution or live owner/version may survive this exception; facts stay untouched.
      if (
        endpoint.enabled === 0 &&
        typeof endpoint.loop_id === 'string' &&
        !(stored.loops ?? []).some((row) => row.id === endpoint.loop_id) &&
        !(stored.loop_versions ?? []).some((row) => row.loop_id === endpoint.loop_id) &&
        !(stored.runs ?? []).some((row) => row.loop_id === endpoint.loop_id)
      ) {
        retired.add(String(endpoint.id));
        continue;
      }
      const version = (stored.loop_versions ?? []).find(
        (row) => row.id === endpoint.version_id && row.loop_id === endpoint.loop_id,
      );
      const loop = (stored.loops ?? []).find(
        (row) => row.id === endpoint.loop_id && row.owner_id === endpoint.owner_id,
      );
      const definition = version ? storedJson(version.definition) : undefined;
      const node: unknown =
        object(definition) && Array.isArray(definition.nodes)
          ? definition.nodes.find(
              (value: unknown) =>
                object(value) && value.id === endpoint.trigger_node_id && value.kind === 'trigger',
            )
          : undefined;
      if (!loop || !object(node)) {
        refuse(path, 'endpoint has no exact owner/loop/version/trigger provenance');
        continue;
      }
      const parsed = WebhookConfigSchema.safeParse(node.config);
      if (!parsed.success) {
        refuse(path, 'stored endpoint trigger is not a supported native webhook');
        continue;
      }
      const config = parsed.data;
      const scheme = endpoint.signature_scheme ?? 'hmac-sha256';
      const window = 'replayWindowSeconds' in config ? config.replayWindowSeconds : null;
      if (
        scheme !== config.signature.scheme ||
        endpoint.signature_header !== config.signature.header.toLowerCase() ||
        endpoint.secret_ref !== config.signature.secretRef ||
        endpoint.replay_window_seconds !== window
      ) {
        refuse(path, 'stored signing fields do not match the exact version definition');
        continue;
      }
      configs.set(String(endpoint.id), config);
    } catch {
      refuse(path, 'endpoint provenance cannot be inventoried');
    }
  }
  for (const receipt of stored.webhook_receipts ?? [])
    if (receipt.status === 'pending')
      issues.push({
        code: 'UPGRADE_PENDING_WEBHOOK',
        path: '/webhook_receipts/' + String(receipt.id),
        message: 'finish pending webhook admission with the old build before offline upgrade',
      });
  for (const event of stored.inbound_events ?? []) {
    if (
      event.type !== 'webhook' ||
      typeof event.source !== 'string' ||
      !event.source.startsWith('webhook:')
    )
      continue;
    const endpointId = event.source.slice('webhook:'.length);
    const endpoint = (stored.webhook_endpoints ?? []).find(
      (row) => row.id === endpointId && row.owner_id === event.owner_id,
    );
    const config = configs.get(endpointId);
    const path = '/inbound_events/' + String(event.id);
    if (endpoint && retired.has(endpointId)) {
      try {
        const runIds: unknown = storedJson(event.run_ids);
        if (!Array.isArray(runIds) || runIds.length !== 0) throw new Error();
      } catch {
        refuse(path, 'deleted endpoint delivery retains malformed or unresolved execution links');
      }
      continue;
    }
    if (!endpoint || !config) {
      refuse(path, 'delivery has no exact endpoint provenance');
      continue;
    }
    if (
      typeof event.dedupe_key === 'string' &&
      /^sig:sha256=[a-fA-F0-9]{64}$/.test(event.dedupe_key)
    ) {
      // Endpoint version IDs move on publish. A filtered delivery has no run/version binding,
      // so a signature-looking key is automatic only when every retained producing version
      // agrees. Never infer an older author's key from the latest configuration.
      try {
        const modes = new Set<boolean>();
        for (const version of stored.loop_versions ?? []) {
          if (version.loop_id !== endpoint.loop_id) continue;
          const definition = storedJson(version.definition);
          if (!object(definition) || !Array.isArray(definition.nodes)) throw new Error();
          const node: unknown = definition.nodes.find(
            (value: unknown) => object(value) && value.id === endpoint.trigger_node_id,
          );
          if (node === undefined) continue;
          if (!object(node) || node.kind !== 'trigger') throw new Error();
          const historical = WebhookConfigSchema.parse(node.config);
          modes.add(
            historical.dedupeKey === undefined && historical.signature.scheme === 'hmac-sha256',
          );
        }
        if (modes.size !== 1) throw new Error();
      } catch {
        refuse(
          path,
          'retained versions do not prove whether the signature-looking key was authored or generated',
        );
        continue;
      }
    }
    if (config.dedupeKey !== undefined || config.signature.scheme !== 'hmac-sha256') continue;
    if (typeof event.dedupe_key === 'string' && /^sig-hash:[a-f0-9]{64}$/.test(event.dedupe_key))
      continue;
    const match =
      typeof event.dedupe_key === 'string'
        ? /^sig:sha256=([a-fA-F0-9]{64})$/.exec(event.dedupe_key)
        : null;
    if (!match?.[1]) {
      refuse(path, 'known default signature key is malformed or ambiguous');
      continue;
    }
    try {
      const runIds: unknown = storedJson(event.run_ids);
      if (!Array.isArray(runIds) || runIds.some((id) => typeof id !== 'string')) throw new Error();
      for (const runId of runIds) {
        const run = (stored.runs ?? []).find(
          (row) =>
            row.id === runId &&
            row.owner_id === event.owner_id &&
            row.loop_id === endpoint.loop_id &&
            row.version_id === endpoint.version_id,
        );
        const thread = run ? storedJson(run.initial_thread) : undefined;
        const invocation =
          object(thread) && object(thread.invocation) ? thread.invocation : undefined;
        const trigger = invocation && object(invocation.trigger) ? invocation.trigger : undefined;
        if (
          !run ||
          !trigger ||
          trigger.nodeId !== endpoint.trigger_node_id ||
          trigger.dedupeKey !== event.dedupe_key ||
          invocation?.source !== 'webhook'
        )
          throw new Error();
      }
      keys.push({
        inboundId: String(event.id),
        previous: String(event.dedupe_key),
        next: 'sig-hash:' + createHash('sha256').update(Buffer.from(match[1], 'hex')).digest('hex'),
        runIds: runIds as string[],
      });
    } catch {
      refuse(path, 'linked run invocation does not prove the generated default key');
    }
  }
  return { issues, keys };
}
/** Only the known immutable invocation key. Arbitrary payloads/variables are never rewritten. */
export function rewriteWebhookThreadKey(value: unknown, previous: string, next: string): unknown {
  const result: unknown = structuredClone(value);
  if (
    !object(result) ||
    !object(result.invocation) ||
    !object(result.invocation.trigger) ||
    result.invocation.trigger.dedupeKey !== previous
  )
    throw new Error('known webhook invocation key does not match its linked delivery');
  result.invocation.trigger.dedupeKey = next;
  return result;
}
