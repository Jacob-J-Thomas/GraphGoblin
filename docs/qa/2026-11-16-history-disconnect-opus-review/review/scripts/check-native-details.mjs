// Offline, read-only detail checks on the #419 candidate native summary.
// Usage: node check-native-details.mjs <candidate summary.json>
import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let leaks = 0;
for (const [name, value] of Object.entries(summary.cases)) {
  const settled = (value.listenerSnapshots ?? []).find((snapshot) => snapshot.at === 'handler-settled');
  const added = settled ? settled.observed.filter((entry) => entry.added !== 0) : [];
  if (added.length) leaks++;
  const trace = value.trace ?? [];
  const closeIndex = trace.findIndex((step) => step.event === 'response-close');
  let heldReturnedBeforeClose = 'n/a';
  if (closeIndex >= 0 && /^(closed-during|closed-page)/.test(name)) {
    const held = value.stageReached;
    const returned = trace.findIndex((step) => step.event === 'sqlite-returned' && step.stage === held);
    const barrier = trace.findIndex((step) => step.event === 'barrier-entered' && step.stage === held);
    heldReturnedBeforeClose = `sqlite-returned@${returned + 1} barrier@${barrier + 1} close@${closeIndex + 1}`;
  }
  const responsiveness = value.responsiveness ? JSON.stringify(value.responsiveness) : '';
  console.log(
    `${name.padEnd(34)} settledSnapshot=${settled ? 'yes' : 'no'} addedAtSettle=${JSON.stringify(added)} ${heldReturnedBeforeClose} ${responsiveness}`,
  );
}
console.log('cases with listeners left at settlement:', leaks);
