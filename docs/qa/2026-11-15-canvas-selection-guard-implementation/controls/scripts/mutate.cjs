// Writes one named mutation of the final candidate OrthogonalEdge.tsx to the worktree path.
// usage: node mutate.cjs <name> <candidate> <target>
const fs = require('fs');
const [name, candidate, target] = process.argv.slice(2);
let text = fs.readFileSync(candidate, 'utf8');
const once = (from, to) => {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`mutation anchor found ${parts.length - 1} times: ${from}`);
  text = parts.join(to);
};
const guard = 'if (event.detail > 1) {';
switch (name) {
  case 'detail-gte-1':
    // Refuses every pointer click, counted 1 too.
    once(guard, 'if (event.detail >= 1) {');
    break;
  case 'detail-neq-1':
    // Refuses a keyboard click, counted 0, as well as later pointer clicks.
    once(guard, 'if (event.detail !== 1) {');
    break;
  case 'propagation-after-guard':
    // A refused click is no longer ended on the button: stopPropagation only runs once it acts.
    once(
      '                event.stopPropagation();\n                // A later click of a double or triple click',
      '                // A later click of a double or triple click',
    );
    once(
      '                if (settling) return;\n                editing.remove(edgeId);',
      '                event.stopPropagation();\n                if (settling) return;\n                editing.remove(edgeId);',
    );
    break;
  default:
    throw new Error('unknown mutation ' + name);
}
fs.writeFileSync(target, text);
console.log('wrote', name, 'to', target);
