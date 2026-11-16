// Read-only digest of baseline-attempt-3 evidence. Prints JSON; writes nothing.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
const root = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const E = join(root, 'launcher-438-native-preparation-v3/attempts/baseline-attempt-3/evidence');
const j = (n) => JSON.parse(readFileSync(join(E, n), 'utf8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const names = readdirSync(E).sort();
const procs = names.filter((n) => /^process-\d{3}-outcome\.json$/.test(n)).map((n) => {
  const o = j(n); const id = n.slice(8, 11);
  const exe = basename(o.executable);
  const timeout = existsSync(join(E, 'process-' + id + '-timeout.json'));
  return { id, label: o.label, pid: o.pid, exe, args: o.args.length, requestedUtc: o.requestedUtc,
    exit: o.exit, close: o.close, stdoutBytes: o.stdoutBytes, stderrBytes: o.stderrBytes,
    stderrSample: o.stderr ? o.stderr.slice(0, 220) : '', exitCloseEqual: !!o.exit && !!o.close && o.exit.code === o.close.code,
    timeoutFile: timeout, outcomeSha256: sha(join(E, n)) };
});
const attemptsWithoutOutcome = names.filter((n) => /-attempt\.json$/.test(n))
  .map((n) => n.slice(8, 11)).filter((id) => !names.includes('process-' + id + '-outcome.json'));
const extraFiles = names.filter((n) => !/^process-\d{3}-(attempt|spawn|outcome)\.json$/.test(n) && !/^inventory-\d{4}\.json$/.test(n));
console.log(JSON.stringify({ count: procs.length, attemptsWithoutOutcome, procs, otherEvidence: extraFiles }, null, 1));
