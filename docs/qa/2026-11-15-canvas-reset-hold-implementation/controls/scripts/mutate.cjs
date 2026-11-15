// Writes a mutated copy of the candidate production file; each mutation must match exactly once.
const fs = require('fs');
const [, , source, target, id] = process.argv;
const text = fs.readFileSync(source, 'utf8');
const BLOCK = `  if (hold) {
    if (!manual) {
      if (hold.reset) setHold({ ...hold, reset: undefined });
    } else if (points !== hold.reset) setHold(undefined);
  }
`;
const mutations = {
  // The anchor is not held: the toolbar always follows the label.
  'anchor-not-held': ['  const anchor = hold?.at ?? labelAt;\n', '  const anchor = labelAt;\n'],
  // No Reset slot on an automatic route: the button goes, as before.
  'no-reset-slot': ['{manual || hold ? (', '{manual ? ('],
  // The hold never ends.
  'hold-never-ends': [BLOCK, ''],
  // Reset's click is not stopped at the button.
  'no-stop-propagation': [
    '                  event.stopPropagation();\n                  if (settling || !manual) return;\n                  setHold(',
    '                  if (settling || !manual) return;\n                  setHold(',
  ],
  // The design's point-reference comparison only: the hold ends when a different array is drawn.
  'identity-only': [BLOCK, '  if (hold && manual && points !== hold.reset) setHold(undefined);\n'],
};
const mutation = mutations[id];
if (!mutation) throw new Error(`unknown mutation ${id}`);
const [from, to] = mutation;
const count = text.split(from).length - 1;
if (count !== 1) throw new Error(`mutation ${id} matched ${count} times`);
fs.writeFileSync(target, text.replace(from, () => to));
