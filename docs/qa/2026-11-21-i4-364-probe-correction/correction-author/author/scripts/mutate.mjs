// Apply one pre-declared counterfactual mutation to the corrected harness.ts, or restore it.
// Usage: node mutate.mjs <M1|M2|M3|M4|restore> <harness.ts> <frozen-corrected-copy> <expected-sha256>
// Each mutation's search text must occur exactly once; restore copies the frozen bytes back and
// verifies the SHA-256 of the result.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [id, target, frozen, expected] = process.argv.slice(2);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const GUARD =
  "  // Lost check output is incomplete evidence: no state is inferred from its stdout or stderr.\n" +
  '  if (probe && result.outputFailed)\n' +
  "    throw new CheckProcessFailure('Claude CLI check output could not be read.');\n";
const EXIT_SITE = '  if (probe && (result.stdinFailed || result.exitCode !== 0))\n';
const mutations = {
  // F1 precedence reverted: the lost-output guard goes back below readiness inference.
  M1: [
    [GUARD, ''],
    [EXIT_SITE, GUARD.split('\n').slice(1).join('\n') + EXIT_SITE],
  ],
  // F2 distinction ignored by the help wrapper.
  M2: [['          !(error instanceof CheckProcessFailure) &&\n', '']],
  // Over-broad distinction: the ordinary probe exit/stdin failure also becomes the private type.
  M3: [
    [
      EXIT_SITE + "    throw new ClaudeHarnessError(\n      'HARNESS_TURN_FAILED',\n",
      EXIT_SITE + '    throw new CheckProcessFailure(\n',
    ],
  ],
  // Over-correction: probe readiness inference removed entirely.
  M4: [
    [
      "  if (probe && result.exitCode !== 0 && result.failureState && result.failureState !== 'unknown') {\n",
      "  if (probe && result.exitCode !== 0 && result.failureState && result.failureState !== 'unknown' && false) {\n",
    ],
  ],
};
const original = readFileSync(frozen);
if (sha(original) !== expected) throw new Error(`frozen copy hash ${sha(original)} != ${expected}`);
if (id === 'restore') {
  writeFileSync(target, original);
  const restored = sha(readFileSync(target));
  if (restored !== expected) throw new Error(`restored hash ${restored} != ${expected}`);
  console.log(`restored ${target} sha256 ${restored}`);
} else {
  if (sha(readFileSync(target)) !== expected) throw new Error('target is not the corrected source');
  let text = original.toString('utf8');
  for (const [from, to] of mutations[id]) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${id}: search text occurs ${count} times`);
    text = text.replace(from, () => to);
  }
  writeFileSync(target, text);
  console.log(`${id} applied; mutated sha256 ${sha(Buffer.from(text, 'utf8'))}`);
}
