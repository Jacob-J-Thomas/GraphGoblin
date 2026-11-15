// Applies the contract-test edit: parameterizes observeWindow (default unchanged) and appends the
// new describe from scratch/contract-addition.txt. Run once from apps/web.
const fs = require('fs');
const path = require('path');
const target = 'src/editor/viewport-gesture.contract.test.tsx';
const addition = fs.readFileSync(
  path.join(__dirname, '..', 'scratch', 'contract-addition.txt'),
  'utf8',
);
let s = fs.readFileSync(target, 'utf8');
const replace = (from, to) => {
  if (!s.includes(from)) throw new Error('anchor missing: ' + from.slice(0, 60));
  if (s.split(from).length !== 2) throw new Error('anchor not unique: ' + from.slice(0, 60));
  s = s.replace(from, () => to);
};
replace(
  '/** Passive window listeners added after the canvas mounted and before any press. */\nfunction observeWindow() {',
  '/**\n * Passive window listeners added after the canvas mounted and before any press, for `types`\n * (the pan and drag tests read releases and clicks).\n */\nfunction observeWindow(types: readonly string[] = [\'mouseup\', \'click\']) {',
);
replace(
  "  for (const type of ['mouseup', 'click']) {\n    window.addEventListener(type, capture, { capture: true, passive: true });",
  '  for (const type of types) {\n    window.addEventListener(type, capture, { capture: true, passive: true });',
);
replace(
  "      for (const type of ['mouseup', 'click']) {\n        window.removeEventListener(type, capture, { capture: true });",
  '      for (const type of types) {\n        window.removeEventListener(type, capture, { capture: true });',
);
if (!s.endsWith('\n')) s += '\n';
s += addition;
fs.writeFileSync(target, s);
console.log('patched', target);
