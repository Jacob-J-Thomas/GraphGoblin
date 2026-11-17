import { posix } from 'node:path';

const productionTargets = new Map([
  ['LaunchContract', 'library'],
  ['LauncherEngine', 'library'],
  ['LauncherPresentation', 'library'],
  ['LauncherEntry', 'executable'],
  ['LauncherInstaller', 'library'],
  ['InstallerEntry', 'executable'],
]);

export const presentationFixture = Object.freeze({
  name: 'PresentationFixture',
  path: 'Tests/PresentationFixture',
  source: 'PresentationFixture.swift',
});

const presentationProfiles = [
  'cancelled.profraw',
  'failure-ok.profraw',
  'panel-quit-grace.profraw',
  'progress-menu-quit.profraw',
];

// These exact sources declare types and interfaces. An executable compiler mapping
// still takes precedence, including if a toolchain instruments synthesized code.
const declarationOnly = new Map([
  ['LaunchContract.swift', '60cde1d6d8d64bfe42b316b174c70c7d71f5fea1070c8f27cc0fb78aaff75fdc'],
  [
    'Presentation/PresentationSeams.swift',
    '870aeff6f1eda291bd9532b1c401569ede7c1f9e548464f3b12807512a5e3201',
  ],
]);

const metrics = ['lines', 'regions', 'branches'];

function requireCondition(ok, message) {
  if (!ok) throw new Error(message);
}

// Inputs come independently from SwiftPM's target description and Git's tracked files.
export function productionInventory(description, trackedSwift) {
  requireCondition(Array.isArray(description.targets), 'SwiftPM target list is missing');
  const matching = description.targets.filter((target) => target.name === presentationFixture.name);
  requireCondition(matching.length === 1, 'Expected one test-only PresentationFixture target');
  const [fixture] = matching;
  const fixtureSource = posix.join(presentationFixture.path, presentationFixture.source);
  const dependencies = fixture.target_dependencies;
  requireCondition(
    fixture.type === 'executable' &&
      fixture.module_type === 'SwiftTarget' &&
      fixture.path === presentationFixture.path &&
      Array.isArray(fixture.sources) &&
      fixture.sources.length === 1 &&
      fixture.sources[0] === presentationFixture.source &&
      trackedSwift.has(fixtureSource) &&
      Array.isArray(dependencies) &&
      dependencies.length === 2 &&
      dependencies.includes('LaunchContract') &&
      dependencies.includes('LauncherPresentation') &&
      !fixture.product_dependencies?.length &&
      (fixture.product_memberships ?? []).every((product) => product === presentationFixture.name),
    'Unexpected PresentationFixture executable metadata',
  );
  const sources = new Map();
  const targets = new Set();
  for (const target of description.targets) {
    if (target.type === 'test' || target === fixture) continue;
    requireCondition(
      !target.target_dependencies?.includes(presentationFixture.name) &&
        !target.product_dependencies?.includes(presentationFixture.name),
      'Swift production target cannot depend on PresentationFixture: ' + target.name,
    );
    requireCondition(
      productionTargets.get(target.name) === target.type &&
        productionTargets.has(target.name) &&
        target.module_type === 'SwiftTarget' &&
        !targets.has(target.name) &&
        Array.isArray(target.sources) &&
        target.sources.length > 0,
      'Unexpected Swift production target: ' + target.name,
    );
    targets.add(target.name);
    for (const source of target.sources) {
      const path = posix.join(target.path, source);
      requireCondition(
        path.endsWith('.swift') && trackedSwift.has(path) && !sources.has(path),
        'Untracked, unexpected or duplicate Swift production source: ' + path,
      );
      sources.set(path, target.name);
    }
  }
  requireCondition(targets.size === productionTargets.size, 'Missing Swift production target');
  for (const path of trackedSwift) {
    if (path.startsWith('Tests/')) continue;
    requireCondition(
      sources.has(path),
      'Tracked Swift production source absent from SwiftPM: ' + path,
    );
  }
  return sources;
}

export function coverageRows(exported, directory) {
  requireCondition(
    exported.type === 'llvm.coverage.json.export' &&
      exported.version === '2.0.1' &&
      exported.data?.length === 1 &&
      Array.isArray(exported.data[0].files),
    'Unexpected LLVM coverage export structure',
  );
  const rows = new Map();
  for (const { filename, summary } of exported.data[0].files) {
    requireCondition(
      typeof filename === 'string' && posix.isAbsolute(filename),
      'Unbound LLVM filename',
    );
    const path = posix.relative(directory, filename);
    if (path.startsWith('../') || path.startsWith('Tests/')) continue;
    requireCondition(!rows.has(path), 'Duplicate LLVM source mapping: ' + path);
    const row = {};
    for (const name of metrics) {
      const { count, covered } = summary?.[name] ?? {};
      requireCondition(
        Number.isSafeInteger(count) &&
          Number.isSafeInteger(covered) &&
          covered >= 0 &&
          count >= covered,
        'Invalid LLVM ' + name + ' counts: ' + path,
      );
      row[name] = { count, covered };
    }
    rows.set(path, row);
  }
  return rows;
}

const zero = () => ({
  lines: { count: 0, covered: 0 },
  regions: { count: 0, covered: 0 },
  branches: { count: 0, covered: 0 },
});

function add(target, file) {
  for (const metric of metrics) {
    target[metric].count += file[metric].count;
    target[metric].covered += file[metric].covered;
  }
}

export function checkCoverage({ sources, sourceDigests, baseline, observed }) {
  for (const path of new Set([...baseline.keys(), ...observed.keys()])) {
    requireCondition(
      sources.has(path),
      'LLVM mapped a source outside the production inventory: ' + path,
    );
    requireCondition(
      baseline.has(path) && observed.has(path),
      'LLVM coverage source set changed: ' + path,
    );
  }
  const targets = Object.fromEntries([...productionTargets.keys()].map((name) => [name, zero()]));
  const files = [];
  const totals = zero();
  for (const [path, target] of [...sources].sort(([left], [right]) => left.localeCompare(right))) {
    const actual = observed.get(path) ?? zero();
    const mapped = baseline.get(path) ?? zero();
    const executable = mapped.lines.count > 0 && mapped.regions.count > 0;
    requireCondition(
      executable ||
        (metrics.every((metric) => mapped[metric].count === 0) &&
          declarationOnly.has(path) &&
          declarationOnly.get(path) === sourceDigests.get(path)),
      'No executable mapping or verified declaration-only source: ' + path,
    );
    for (const metric of metrics) {
      requireCondition(
        mapped[metric].covered === 0 && mapped[metric].count === actual[metric].count,
        'LLVM baseline/observed denominator differs or baseline has hits: ' + path + ' ' + metric,
      );
    }
    add(targets[target], actual);
    add(totals, actual);
    files.push({
      path,
      target,
      sha256: sourceDigests.get(path),
      mapping: executable ? 'executable' : 'declaration-only',
      ...actual,
    });
  }
  requireCondition(
    totals.lines.count > 0 && totals.regions.count > 0,
    'Empty Swift coverage denominator',
  );
  const meetsThreshold = [totals.lines, totals.regions].every(
    ({ count, covered }) => BigInt(covered) * 100n >= BigInt(count) * 90n,
  );
  return {
    files,
    targets,
    totals,
    meetsThreshold,
    nativeBranchesAvailable: totals.branches.count > 0,
  };
}

export function verifyCoverageSentinel({ left, right, combined, rightUnrun }) {
  for (const metric of ['lines', 'regions']) {
    const union = combined.get('Shared.swift')?.[metric];
    requireCondition(union?.count > 0, 'LLVM sentinel is missing the combined shared mapping');
    requireCondition(
      union.covered === union.count,
      'LLVM sentinel did not combine complementary ' + metric,
    );

    for (const report of [left, right]) {
      const single = report.get('Shared.swift')?.[metric];
      requireCondition(
        single?.count === union.count,
        'LLVM sentinel did not deduplicate ' + metric,
      );
      requireCondition(
        single.covered > 0 && single.covered < union.covered,
        'LLVM sentinel profile did not exercise one arm: ' + metric,
      );
    }
    for (const [report, path, hasHits] of [
      [rightUnrun, 'Right.swift', false],
      [combined, 'Untouched.swift', false],
      [combined, 'Left.swift', true],
      [combined, 'Right.swift', true],
    ]) {
      const counters = report.get(path)?.[metric];
      requireCondition(counters?.count > 0, 'LLVM sentinel omitted executable mapping: ' + path);
      requireCondition(
        counters.covered > 0 === hasHits,
        'LLVM sentinel retained incorrect hits: ' + path,
      );
    }
  }
}

export function verifyPresentationProfiles(names) {
  requireCondition(
    names.length === presentationProfiles.length &&
      [...names].sort().every((name, index) => name === presentationProfiles[index]),
    'Expected the four distinct PresentationFixture raw profiles',
  );
}

export function verifyPresentationCoverage(rows) {
  const entry = rows.get('Presentation/LauncherPresentationEntry.swift');
  requireCondition(
    entry?.lines.covered > 0 && entry.regions.covered > 0,
    'PresentationFixture did not record production composition coverage',
  );
}
