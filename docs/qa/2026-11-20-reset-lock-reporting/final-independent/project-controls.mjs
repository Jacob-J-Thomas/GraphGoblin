import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function projectControls(bytes, scratchRoot, originalFile) {
  const data = JSON.parse(bytes);
  const aliases = [
    [data.provenanceBefore.checkout, '<checkout>'],
    [scratchRoot, '<qa>'],
  ].sort((a, b) => b[0].length - a[0].length);
  const scrub = (value) => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
    if (typeof value !== 'string') return value;
    for (const [prefix, alias] of aliases) {
      value = value
        .replaceAll(prefix.replaceAll('\\', '/'), alias)
        .replaceAll(prefix.replaceAll('/', '\\'), alias);
    }
    return value.replace(
      /^[ \t]*(?:node|pnpm(?:\.cmd)?|powershell(?:\.exe)?|cmd(?:\.exe)?)\s+[^\r\n]*$/gm,
      '  <command line omitted; executed driver preserved>',
    );
  };
  const result = {
    schemaVersion: 1,
    original: {
      file: path.basename(originalFile),
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
    projection: {
      retained:
        'Every scenario, assertion, original outcome and total; CLI output, manifests, parsed refusal lines and filesystem diffs.',
      omitted:
        'Raw argv, environment values, helper process output and full tree snapshots. No assertion is dropped or regraded.',
      substitutions:
        'Checkout/scratch prefixes become role aliases; complete command lines are marked omitted; method entrypoint is described without argv.',
    },
    schema: data.schema,
    issue: data.issue,
    label: data.label,
    evidenceSource: data.evidenceSource,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    provenanceBefore: scrub(data.provenanceBefore),
    provenanceAfter: scrub(data.provenanceAfter),
    method: scrub(data.method),
    fixtures: data.fixtures,
    totals: data.totals,
    scenarios: data.scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      assertions: scrub(s.assertions),
      runs: s.runs.map((r) =>
        scrub({
          name: r.name,
          exitCode: r.exitCode,
          signal: r.signal,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          ms: r.ms,
          stdout: r.stdout,
          stderr: r.stderr,
          manifest: r.manifest,
          parsedStderr: r.parsedStderr,
          fsDiff: r.fsDiff,
          tempLeftovers: r.tempLeftovers,
        }),
      ),
    })),
  };
  result.method.entrypoint =
    'Real built reset CLI in a separate process, with disposable fixture arguments.';
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4)
    throw new Error('Usage: node project-controls.mjs <original.json> <scratch-root>');
  process.stdout.write(
    JSON.stringify(
      projectControls(fs.readFileSync(process.argv[2]), process.argv[3], process.argv[2]),
      null,
      2,
    ) + '\n',
  );
}
