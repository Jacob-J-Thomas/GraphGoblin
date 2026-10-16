import { describe, expect, it } from 'vitest';
import { inspectTriggerUpgrade, rewriteWebhookThreadKey } from './trigger-upgrade.js';
const signature = 'ab'.repeat(32);
function store(custom = false) {
  return {
    loops: [{ id: 'loop', owner_id: 'local' }],
    loop_versions: [
      {
        id: 'version',
        loop_id: 'loop',
        definition: JSON.stringify({
          nodes: [
            {
              id: 'hook',
              kind: 'trigger',
              config: {
                subtype: 'webhook',
                signature: { scheme: 'hmac-sha256', secretRef: 'secret' },
                ...(custom ? { dedupeKey: 'payload.id' } : {}),
              },
            },
          ],
        }),
      },
    ],
    webhook_endpoints: [
      {
        id: 'ep',
        owner_id: 'local',
        loop_id: 'loop',
        version_id: 'version',
        trigger_node_id: 'hook',
        signature_header: 'x-graphgoblin-signature',
        secret_ref: 'secret',
        replay_window_seconds: 300,
      },
    ],
    inbound_events: [
      {
        id: 'event',
        owner_id: 'local',
        type: 'webhook',
        source: 'webhook:ep',
        dedupe_key: 'sig:sha256=' + signature,
        run_ids: '[]',
      },
    ],
  };
}
describe('exact webhook upgrade provenance', () => {
  it('rewrites only proven default keys and preserves prefix-looking authored keys', () => {
    expect(inspectTriggerUpgrade(store())).toMatchObject({
      issues: [],
      keys: [
        {
          inboundId: 'event',
          previous: 'sig:sha256=' + signature,
          next: expect.stringMatching(/^sig-hash:[a-f0-9]{64}$/),
        },
      ],
    });
    expect(inspectTriggerUpgrade(store(true))).toEqual({ issues: [], keys: [] });
  });
  it('refuses signature-looking filtered keys when retained producing versions disagree', () => {
    for (const latestCustom of [false, true]) {
      const stored = store(latestCustom);
      stored.loop_versions.push({ ...store(!latestCustom).loop_versions[0]!, id: 'older-version' });
      const result = inspectTriggerUpgrade(stored);
      expect(result.keys).toEqual([]);
      expect(result.issues).toEqual([
        expect.objectContaining({
          code: 'UPGRADE_WEBHOOK_PROVENANCE_REFUSED',
          path: '/inbound_events/event',
        }),
      ]);
    }
    const unchanged = store();
    unchanged.loop_versions.push({ ...store().loop_versions[0]!, id: 'older-version' });
    expect(inspectTriggerUpgrade(unchanged).issues).toEqual([]);
    expect(inspectTriggerUpgrade(unchanged).keys).toHaveLength(1);
    const malformed = store();
    malformed.loop_versions.push({ id: 'bad', loop_id: 'loop', definition: 'invalid' });
    expect(inspectTriggerUpgrade(malformed).issues).toHaveLength(1);
    const absent = store();
    absent.loop_versions.push({
      id: 'unrelated-version',
      loop_id: 'loop',
      definition: '{"nodes":[]}',
    });
    expect(inspectTriggerUpgrade(absent).issues).toEqual([]);
  });
  it('refuses orphan endpoint versions, mismatched fields, malformed known defaults and orphan deliveries', () => {
    const missing = store();
    missing.loop_versions = [];
    expect(inspectTriggerUpgrade(missing).issues).toHaveLength(2);
    const mismatch = store();
    mismatch.webhook_endpoints[0]!.signature_header = 'wrong';
    expect(inspectTriggerUpgrade(mismatch).issues).toHaveLength(2);
    const bad = store();
    bad.inbound_events[0]!.dedupe_key = 'sig:bad';
    expect(inspectTriggerUpgrade(bad).issues).toHaveLength(1);
    const orphan = store();
    orphan.inbound_events[0]!.source = 'webhook:missing';
    expect(inspectTriggerUpgrade(orphan).issues).toHaveLength(1);
  });
  it('requires disabled, wholly absent deleted-loop provenance and empty delivery links', () => {
    const retired = {
      ...store(),
      loops: [],
      loop_versions: [],
      webhook_endpoints: store().webhook_endpoints.map((endpoint) => ({ ...endpoint, enabled: 0 })),
    };
    expect(inspectTriggerUpgrade(retired)).toEqual({ issues: [], keys: [] });
    for (const unsafe of [
      {
        ...retired,
        webhook_endpoints: retired.webhook_endpoints.map((endpoint) => ({
          ...endpoint,
          enabled: 1,
        })),
      },
      { ...retired, loops: store().loops },
      { ...retired, loops: [{ id: 'loop', owner_id: 'another-owner' }] },
      { ...retired, loop_versions: store().loop_versions },
      { ...retired, runs: [{ id: 'run', loop_id: 'loop' }] },
      {
        ...retired,
        inbound_events: retired.inbound_events.map((event) => ({
          ...event,
          run_ids: '["missing"]',
        })),
      },
      {
        ...retired,
        inbound_events: retired.inbound_events.map((event) => ({ ...event, run_ids: 'invalid' })),
      },
      {
        ...retired,
        inbound_events: retired.inbound_events.map((event) => ({
          ...event,
          owner_id: 'another-owner',
        })),
      },
    ])
      expect(inspectTriggerUpgrade(unsafe).issues.length).toBeGreaterThan(0);
  });
  it('does not rewrite arbitrary payload/variable copies and refuses a mismatched immutable thread key', () => {
    const thread = {
      invocation: { trigger: { dedupeKey: 'old' } },
      vars: { key: 'old' },
      payload: 'old',
    };
    expect(rewriteWebhookThreadKey(thread, 'old', 'new')).toEqual({
      ...thread,
      invocation: { trigger: { dedupeKey: 'new' } },
    });
    expect(thread.invocation.trigger.dedupeKey).toBe('old');
    for (const value of [null, {}, thread])
      expect(() => rewriteWebhookThreadKey(value, 'mismatch', 'new')).toThrow();
  });
});

it('refuses pending admissions and mismatched linked immutable run facts', () => {
  expect(
    inspectTriggerUpgrade({ webhook_receipts: [{ id: 'pending', status: 'pending' }] }).issues,
  ).toEqual([
    {
      code: 'UPGRADE_PENDING_WEBHOOK',
      path: '/webhook_receipts/pending',
      message: expect.any(String),
    },
  ]);
  const stored = store();
  stored.inbound_events[0]!.run_ids = '["missing"]';
  expect(inspectTriggerUpgrade(stored).issues).toHaveLength(1);
  stored.inbound_events[0]!.run_ids = 'invalid';
  expect(inspectTriggerUpgrade(stored).issues).toHaveLength(1);
});
