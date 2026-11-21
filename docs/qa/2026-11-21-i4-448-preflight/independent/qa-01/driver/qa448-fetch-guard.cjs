// Independent QA #448 child-only preload (NODE_OPTIONS=--require). Blocks and records any fetch to
// port 11434 (the default/owner Ollama endpoint) so focused suites whose in-test containers start
// Ollama discovery with the default URL can never contact an owner Ollama. The thrown TypeError
// mirrors an unreachable endpoint (the observed state of this host: nothing listening on 11434).
'use strict';
const { appendFileSync } = require('node:fs');
const LOG = process.env.QA448_FETCH_GUARD_LOG;
const original = globalThis.fetch;
if (typeof original === 'function') {
  globalThis.fetch = async function qa448GuardedFetch(input, init) {
    let href = '';
    try {
      href = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url ?? '');
      const url = new URL(href);
      if (url.port === '11434') {
        if (LOG)
          appendFileSync(LOG, JSON.stringify({ pid: process.pid, url: url.href, utc: new Date().toISOString(), blocked: true }) + '\n');
        throw new TypeError('fetch failed');
      }
    } catch (error) {
      if (error instanceof TypeError && error.message === 'fetch failed') throw error;
    }
    return original.call(this, input, init);
  };
}
