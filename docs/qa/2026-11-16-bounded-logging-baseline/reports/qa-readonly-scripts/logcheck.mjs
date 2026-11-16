// Read-only parse of the retained baseline-attempt-3 managed logs. Prints JSON; writes nothing.
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
const D = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher-438-native-preparation-v3/attempts/baseline-attempt-3/disposable';
const gw = readFileSync(D + '/install/gateway.log');
const lines = gw.toString('utf8').split('\n').filter(Boolean);
let bad = 0; const msgs = {}; const status = {}; const ports = {}; const pids = {}; let authHeader = 0;
let first = null; let last = null;
for (const l of lines) {
  let r; try { r = JSON.parse(l); } catch { bad++; continue; }
  msgs[r.msg] = (msgs[r.msg] ?? 0) + 1;
  pids[r.pid] = (pids[r.pid] ?? 0) + 1;
  if (r.msg === 'request completed') status[r.res?.statusCode] = (status[r.res?.statusCode] ?? 0) + 1;
  if (/^Server listening at /.test(r.msg ?? '')) ports[r.msg] = (ports[r.msg] ?? 0) + 1;
  if (r.req?.headers && Object.keys(r.req.headers).some((k) => k.toLowerCase() === 'authorization')) authHeader++;
  first ??= r.time; last = r.time;
}
const ln = readFileSync(D + '/install/launcher.log', 'utf8');
const db = readFileSync(D + '/store-a/graphgoblin.db').subarray(0, 16).toString('latin1');
const dbShell = readFileSync(D + '/store-shell/graphgoblin.db').subarray(0, 16).toString('latin1');
console.log(JSON.stringify({
  gatewayLog: { bytes: gw.length, lstatBytes: lstatSync(D + '/install/gateway.log').size, sha256: createHash('sha256').update(gw).digest('hex'),
    lines: lines.length, unparsable: bad, messages: msgs, completedStatus: status, listeningRecords: ports, pids,
    recordsWithAuthorizationHeader: authHeader, firstTime: first ? new Date(first).toISOString() : null, lastTime: last ? new Date(last).toISOString() : null },
  launcherLog: { bytes: Buffer.byteLength(ln), lines: ln.split(/\r?\n/).filter(Boolean).length,
    portMentions: [...ln.matchAll(/Port (\d+) belongs/g)].map((m) => m[1]) },
  sqliteHeaders: { storeA: db === 'SQLite format 3\0', storeShell: dbShell === 'SQLite format 3\0' },
}, null, 1));
