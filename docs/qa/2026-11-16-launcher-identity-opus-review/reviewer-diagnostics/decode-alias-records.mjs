// Read-only reviewer diagnostic: decode Node 22 TAP-escaped alias evidence lines from a raw job log.
// Usage: node decode-alias-records.mjs <decoded-log-path>
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
const lines = text.split(/\r?\n/);

// Reverse of Node's TAP reporter escaping for diagnostic lines (backslash first, then specials).
function tapUnescape(input) {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = input[++i];
    const map = { '\\': '\\', '#': '#', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' };
    if (!(next in map)) throw new Error(`Unknown TAP escape \\${next} at ${i}`);
    out += map[next];
  }
  return out;
}

const records = [];
for (const line of lines) {
  const m = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z # (\{"evidence":"windows-launcher-checkout-alias".*)$/.exec(line);
  if (!m) continue;
  records.push(JSON.parse(tapUnescape(m[1])));
}

const summary = records.map((r) => {
  const launches = Object.entries(r.commands).filter(([k]) => !/-identity$|-store-state$|-import$/.test(k));
  return {
    kind: r.kind,
    requestedLinkType: r.requestedLinkType,
    reparse: r.reparse,
    port: r.port,
    storeEntriesBeforeCold: r.storeEntriesBeforeCold,
    helpers: Object.fromEntries(
      Object.entries(r.commands)
        .filter(([k]) => /-identity$|-store-state$|-import$/.test(k))
        .map(([k, v]) => [k, v]),
    ),
    launches: Object.fromEntries(launches.map(([k, v]) => [k, `${v.code}|${v.signal}|${JSON.stringify(v.stdout)}|${JSON.stringify(v.stderr)}`])),
    cold: r.cold.map((c) => ({
      spelling: c.spelling,
      pid: c.owner?.pid,
      birth: c.owner?.birth,
      executable: c.owner?.executable,
      main: c.owner?.main,
      leases: c.owner?.leases,
      release: c.release,
      releaseFailure: c.releaseFailure,
    })),
    failure: r.failure,
    aliasUnlinked: r.aliasUnlinked,
    unlinkFailure: r.unlinkFailure,
    keys: Object.keys(r),
  };
});
process.stdout.write(JSON.stringify({ count: records.length, summary }, null, 2) + '\n');
