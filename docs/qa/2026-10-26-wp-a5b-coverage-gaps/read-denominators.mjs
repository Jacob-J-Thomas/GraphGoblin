import { globSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const paths = [
  'apps/api',
  'apps/mcp',
  'apps/plugin-codex',
  'apps/web',
  'packages/adapter-codex',
  'packages/adapter-jev',
  'packages/api-client',
  'packages/contracts',
  'packages/domain',
  'packages/engine',
  'packages/infrastructure',
  'tooling',
];
const records = [];
const relativeFile = (path) => relative(root, path).replaceAll('\\', '/');
for (const path of paths) {
  const dir = resolve(root, path);
  const configPath = join(dir, path === 'tooling' ? 'vitest.config.mjs' : 'vitest.config.ts');
  const config = (await import(pathToFileURL(configPath).href)).default;
  const policy = config.test.coverage;
  const match = (patterns) =>
    [
      ...new Set(
        patterns.flatMap((pattern) =>
          [...globSync(pattern, { cwd: dir })]
            .filter((file) => statSync(join(dir, file)).isFile())
            .map((file) => file.replaceAll('\\', '/')),
        ),
      ),
    ].sort();
  const included = match(policy.include),
    excluded = match(policy.exclude);
  const expected = included.filter((file) => !excluded.includes(file));
  const summaryPath = join(dir, 'coverage/coverage-summary.json');
  const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;
  const counted = summary
    ? Object.keys(summary)
        .filter((file) => file !== 'total')
        .map((file) => relative(dir, file).replaceAll('\\', '/'))
        .sort()
    : [];
  records.push({
    package: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name,
    path,
    config: relativeFile(configPath),
    provider: policy.provider,
    thresholds: policy.thresholds,
    include: policy.include,
    exclude: policy.exclude,
    autoAttachSubprocess: policy.autoAttachSubprocess ?? false,
    testInclude: config.test.include,
    excludedFiles: excluded,
    expectedFiles: expected,
    countedFiles: counted,
    expectedButNotCounted: expected.filter((file) => !counted.includes(file)),
    countedOutsideConfiguredSet: counted.filter((file) => !expected.includes(file)),
    coverage: summary?.total ?? null,
    fileCoverage: summary
      ? Object.fromEntries(
          Object.entries(summary)
            .filter(([file]) => file !== 'total')
            .map(([file, value]) => [relative(dir, file).replaceAll('\\', '/'), value]),
        )
      : {},
    source: summary ? 'current local coverage-summary.json' : 'not produced',
  });
}
writeFileSync(
  'docs/qa/2026-10-26-wp-a5b-coverage-gaps/denominators.json',
  JSON.stringify({ base: 'dca4272b8f7549d778f077d180e298643396b693', records }, null, 2) + '\n',
);
console.log(
  records.map((r) => ({
    package: r.package,
    expected: r.expectedFiles.length,
    counted: r.countedFiles.length,
    missing: r.expectedButNotCounted.length,
    extra: r.countedOutsideConfiguredSet.length,
    coverage: r.coverage,
  })),
);
