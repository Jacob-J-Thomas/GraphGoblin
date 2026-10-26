import { Timings } from './common.mjs';

/** Supply an observed client to a separate repository, never patch the production repository. */
export function observeAppendClient(client) {
  const spans = new Map();
  const record = (key, ms) => {
    if (!spans.has(key)) spans.set(key, new Timings());
    spans.get(key).add(ms);
  };
  function decorate(target, transaction = false) {
    return new Proxy(target, {
      get(object, key) {
        const value = Reflect.get(object, key);
        if (typeof value !== 'function') return value;
        if (!['transaction', 'execute', 'commit', 'rollback'].includes(key))
          return value.bind(object);
        return async (...args) => {
          const sql = typeof args[0] === 'string' ? args[0] : (args[0]?.sql ?? '');
          const label =
            key === 'execute'
              ? /coalesce\(max\(/i.test(sql)
                ? 'sequenceLookup'
                : /^insert/i.test(sql)
                  ? 'insert'
                  : /^update/i.test(sql)
                    ? 'runSequenceUpdate'
                    : 'otherStatement'
              : key === 'transaction'
                ? 'begin'
                : key;
          const at = performance.now();
          try {
            const result = await value.apply(object, args);
            return key === 'transaction' ? decorate(result, true) : result;
          } finally {
            record((transaction ? 'transaction.' : 'client.') + label, performance.now() - at);
          }
        };
      },
    });
  }
  return {
    client: decorate(client),
    reset() {
      spans.clear();
    },
    summary() {
      return Object.fromEntries([...spans].map(([key, value]) => [key, value.json()]));
    },
  };
}
