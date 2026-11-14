import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const sha = (path) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const bindingPath = 'docs/qa/2026-11-14-node-reference-review-corrected-native/corrected-binding-before.json';
const binding = JSON.parse(readFileSync(resolve(root, bindingPath), 'utf8'));
const mismatches = [];
for (const [group, records] of Object.entries({ critical: binding.critical, sourceReadback: binding.sourceReadback })) {
  for (const [path, expected] of Object.entries(records)) if (sha(path) !== expected) mismatches.push({ group, path });
}
if (mismatches.length) throw new Error(JSON.stringify(mismatches));
const requireDomain = createRequire(resolve(root, 'packages/domain/package.json'));
const { evaluateExpression, renameLoopNode, validateLoop, isPublishable } = await import(pathToFileURL(resolve(root, 'packages/domain/dist/index.js')).href);
const { LoopDefinitionSchema } = await import(pathToFileURL(resolve(root, 'packages/contracts/dist/index.js')).href);
const { minimalLoop } = await import(pathToFileURL(resolve(root, 'packages/contracts/dist/testing/index.js')).href);
const returning = (source) => {
  const definition = minimalLoop();
  definition.nodes = definition.nodes.map(node => node.kind === 'exit' ? { ...node, config: { ...node.config, returns: source } } : node);
  return definition;
};
const evaluate = async (source, view) => {
  try {
    const value = await evaluateExpression(source, view);
    return value === undefined ? { type: 'undefined' } : { type: typeof value, value };
  } catch (error) { return { error: error.message }; }
};
const source = '$lookup(outputs, outputs.start.value).value';
const original = returning(source);
const renamed = renameLoopNode(original, 'start', 'renamed');
if (renamed.kind !== 'renamed') throw new Error(renamed.kind);
const renamedSource = renamed.definition.nodes.find(node => node.kind === 'exit').config.returns;
const beforeView = { outputs: { start: { value: 'choice' }, choice: { value: 'chosen' } } };
const afterView = { outputs: { renamed: { value: 'choice' }, choice: { value: 'chosen' } } };
const missingSource = '$lookup(outputs, $string(counters.nodeVisits.missing))';
const missingDefinition = LoopDefinitionSchema.parse(returning(missingSource));
const directSource = '$string(counters.nodeVisits.missing)';
const directDefinition = LoopDefinitionSchema.parse(returning(directSource));
const output = {
  at: new Date().toISOString(), node: process.version,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }).trim(),
  compiledBinding: { sourceHead: binding.head, recordSha256: sha(bindingPath), criticalFiles: Object.keys(binding.critical).length, sourceFiles: Object.keys(binding.sourceReadback).length, mismatches },
  installedEvaluator: { version: requireDomain('jsonata/package.json').version, path: requireDomain.resolve('jsonata'), sha256: sha(requireDomain.resolve('jsonata')) },
  domainModules: Object.fromEntries(['packages/domain/dist/expression-references.js', 'packages/domain/dist/node-references.js'].map(path => [path, sha(path)])),
  rename: { source, renamedSource, repairedReferences: renamed.repairedReferences, warnings: renamed.warnings, beforeView, afterView, beforeValue: await evaluate(source, beforeView), afterValue: await evaluate(renamedSource, afterView), manuallyRepairedControl: { source: '$lookup(outputs, outputs.renamed.value).value', value: await evaluate('$lookup(outputs, outputs.renamed.value).value', afterView) } },
  missing: { source: missingSource, issues: validateLoop(missingDefinition), publishable: isPublishable(missingDefinition), directControl: { source: directSource, issues: validateLoop(directDefinition), publishable: isPublishable(directDefinition) } },
};
for (const [path, expected] of Object.entries(binding.critical)) if (sha(path) !== expected) throw new Error('Artifact changed: ' + path);
output.compiledBinding.afterMatches = true;
console.log(JSON.stringify(output, null, 2));
