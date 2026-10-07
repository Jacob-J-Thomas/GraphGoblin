// Read attempt authority from GraphGoblin run outputs, never issue comments or GET /events.
import { assert } from './core.mjs';
export function recordsFromEvents(events) {
  return events
    .filter((e) => e.type === 'node.finished')
    .flatMap((e) =>
      e.patch
        .filter(
          (op) =>
            ['add', 'replace'].includes(op.op) &&
            ['/outputs/claim', '/outputs/attempt-record'].includes(op.path),
        )
        .map((op) => ({ ...op.value.value, seq: e.seq })),
    );
}
export async function readAttempts(api, loopId, repository, issueNumber) {
  const records = [];
  let before;
  for (let page = 0; page < 100; page++) {
    const url = new URL('/runs', api);
    url.searchParams.set('loopId', loopId);
    url.searchParams.set('limit', '100');
    if (before) url.searchParams.set('before', before);
    const response = await fetch(url);
    assert(response.ok, 'ATTEMPT_RUN_READER_FAILED');
    const { items } = await response.json();
    for (const run of items) {
      let after = 0;
      for (let n = 0; n < 100; n++) {
        const r = await fetch(`${api}/runs/${run.id}/events?after=${after}&limit=1000`);
        assert(r.ok, 'ATTEMPT_EVENT_READER_FAILED');
        const body = await r.json();
        records.push(
          ...recordsFromEvents(body.items)
            .filter((x) => x.repository === repository && x.issueNumber === issueNumber)
            .map((x) => ({ ...x, runStatus: run.status })),
        );
        if (body.items.length < 1000) break;
        after = body.nextAfter;
        assert(n < 99, 'ATTEMPT_EVENT_READER_BOUND');
      }
    }
    if (items.length < 100) return records;
    before = items.at(-1).createdAt;
  }
  throw new Error('ATTEMPT_RUN_READER_BOUND');
}
