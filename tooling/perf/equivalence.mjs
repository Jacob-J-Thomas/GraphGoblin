import { createHash } from 'node:crypto';

// Compare controlled runs, retaining identity relationships but excluding clock measurements.
// Raw event hashes separately check the HTTP replay against the exact stored bytes.
export function equivalence() {
  const identities = new Map();
  const hash = createHash('sha256');
  function normalize(value, key = '') {
    if (
      [
        'ts',
        'at',
        'createdAt',
        'startedAt',
        'finishedAt',
        'receivedAt',
        'durationMs',
        'elapsedSeconds',
      ].includes(key)
    )
      return '<clock>';
    if (typeof value === 'string')
      return value.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, (id) => {
        if (!identities.has(id)) identities.set(id, `<id:${identities.size}>`);
        return identities.get(id);
      });
    if (Array.isArray(value)) return value.map((item) => normalize(item));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((name) => [name, normalize(value[name], name)]),
      );
    return value;
  }
  return {
    event(event) {
      const normalized = normalize(event);
      hash.update(JSON.stringify(normalized) + '\n');
      return normalized;
    },
    finish(thread, run) {
      return {
        eventsSha256: hash.digest('hex'),
        stateSha256: createHash('sha256')
          .update(
            JSON.stringify(
              normalize({ thread, status: run.status, outcome: run.outcome, result: run.result }),
            ),
          )
          .digest('hex'),
        normalization:
          'Sorted keys; generated ULIDs retain identity relationships; ts/at/createdAt/startedAt/finishedAt/receivedAt/durationMs/elapsedSeconds are clock observations.',
      };
    },
  };
}
