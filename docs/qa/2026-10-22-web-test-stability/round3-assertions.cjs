const fs = require('node:fs');
const cp = require('node:child_process');
const ts = require(require.resolve('typescript', { paths: [process.cwd()] }));
const files = cp.execFileSync('git', ['diff', '--name-only', '--', '*.test.tsx', '*.test.ts'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const printer = ts.createPrinter({ removeComments: true });
function assertions(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect') {
      let root = node;
      while (root.parent && (ts.isPropertyAccessExpression(root.parent) || ts.isCallExpression(root.parent))) root = root.parent;
      result.push(printer.printNode(ts.EmitHint.Unspecified, root, source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}
let missing = 0;
for (const file of files) {
  const original = assertions(file, cp.execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }));
  const current = assertions(file, fs.readFileSync(file, 'utf8'));
  const remaining = [...current];
  const absent = original.filter((assertion) => {
    const index = remaining.indexOf(assertion);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
  missing += absent.length;
  console.log(JSON.stringify({ file, original: original.length, current: current.length, missing: absent.length }));
}
process.exitCode = missing ? 1 : 0;
