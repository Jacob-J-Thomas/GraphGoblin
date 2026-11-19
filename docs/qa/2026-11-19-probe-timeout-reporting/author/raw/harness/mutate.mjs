// Applies one named mutant to the lane's maintained test in place, or restores the fixed bytes.
// Usage: node mutate.mjs <c99-hook|message-dedupe|drop-all-late|restore> [intermediate|final]
// The 2x gates ran the first version of this script, which had only the intermediate source
// (snapshot then named fixed-snapshot.test.ts); the label defaults to it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const target = 'D:/GraphGoblin-AIDLC/2026-11-18-five/lane-b/GraphGoblin/packages/adapter-codex/src/probe-directory.test.ts';
const scratch = 'D:/GraphGoblin-AIDLC/2026-11-18-five/lane-b/midbody-author-scratch';
const sources = {
  intermediate: ['intermediate-snapshot.test.ts', '9fc8ff8d63a6dd74acffa616ced1dc3b1256568765828704b8f74c805cdc18c9'],
  final: ['final-snapshot.test.ts', '70f06fa3abb5a13b5d525799b2c675c6564f2483aa082708f0bcbc3e321edcfb'],
};
const [snapshotName, fixedSha256] = sources[process.argv[3] ?? 'intermediate'];
const snapshot = `${scratch}/${snapshotName}`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixedCondition = [
  '          context.signal.aborted &&',
  "          outcome.status === 'rejected' &&",
  '          outcome.reason !== context.signal.reason',
  '            ? [outcome.reason]',
  '            : [];',
].join('\n');
const mutants = {
  // The published c99 rule: every late rejection, the abort reason included.
  'c99-hook': "          context.signal.aborted && outcome.status === 'rejected' ? [outcome.reason] : [];",
  // Deduplication by text, which the brief forbids.
  'message-dedupe': [
    '          context.signal.aborted &&',
    "          outcome.status === 'rejected' &&",
    '          String(outcome.reason) !== String(context.signal.reason)',
    '            ? [outcome.reason]',
    '            : [];',
  ].join('\n'),
  // Suppression of every late failure after an abort.
  'drop-all-late': '          [] as unknown[];',
};
const mode = process.argv[2];
const fixed = readFileSync(snapshot);
if (sha(fixed) !== fixedSha256) throw new Error('Snapshot drift');
if (mode === 'restore') {
  writeFileSync(target, fixed);
} else {
  const current = readFileSync(target);
  if (sha(current) !== fixedSha256) throw new Error('Target is not the fixed source');
  const source = current.toString('utf8');
  if (source.split(fixedCondition).length !== 2) throw new Error('Fixed condition not found exactly once');
  writeFileSync(target, source.replace(fixedCondition, mutants[mode]));
}
console.log(JSON.stringify({ mode, source: process.argv[3] ?? 'intermediate', targetSha256: sha(readFileSync(target)) }));
