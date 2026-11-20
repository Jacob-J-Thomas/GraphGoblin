import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function projectResults(bytes, qaRoot, originalFile) {
  const data = JSON.parse(bytes);
  const aliases = [
    [data.provenance.checkout, '<checkout>'],
    [qaRoot, '<qa>'],
  ].sort((a, b) => b[0].length - a[0].length);
  const scrub = (value) => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    if (typeof value !== 'string') return value;
    for (const [prefix, alias] of aliases) {
      value = value.replaceAll(prefix.replaceAll('\\', '/'), alias);
      value = value.replaceAll(prefix.replaceAll('/', '\\'), alias);
    }
    return value;
  };
  const result = {
    schemaVersion: 1,
    originalSource: {
      file: path.basename(originalFile),
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
    projection: {
      retained:
        'All scenarios, all assertions including expected/actual/outcome, all original totals, CLI stdout/stderr, manifests, filesystem diffs and temporary leftovers.',
      omitted:
        'Raw argv, GG environment values and setup metadata; complete tree snapshots except S08/S11. No assertion or failure is omitted or regraded.',
      substitutions:
        'Only the checkout and QA scratch prefixes become role aliases. Relative paths, values, ordering and all outcomes stay unchanged.',
    },
    originalSchema: data.schema,
    issue: data.issue,
    label: data.label,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    provenance: scrub(data.provenance),
    method: scrub(data.method),
    fixtures: data.fixtures,
    totals: data.totals,
    scenarios: data.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      assertions: scrub(scenario.assertions),
      runs: (scenario.runs ?? []).map((run) => ({
        name: run.name,
        exitCode: run.exitCode,
        signal: run.signal,
        ms: run.ms,
        stdout: scrub(run.stdout),
        stderr: scrub(run.stderr),
        manifest: scrub(run.manifest),
        fsDiff: scrub(run.fsDiff),
        tempLeftovers: scrub(run.tempLeftovers),
        ...(['S08', 'S11'].includes(scenario.id)
          ? { treeBefore: scrub(run.treeBefore), treeAfter: scrub(run.treeAfter) }
          : {}),
      })),
    })),
  };
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4)
    throw new Error('Usage: node project-results.mjs <original.json> <original-qa-root>');
  process.stdout.write(
    JSON.stringify(
      projectResults(fs.readFileSync(process.argv[2]), process.argv[3], process.argv[2]),
      null,
      2,
    ) + '\n',
  );
}
