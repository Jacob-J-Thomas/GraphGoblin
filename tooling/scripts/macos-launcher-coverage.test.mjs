import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  checkCoverage,
  coverageRows,
  productionInventory,
  verifyCoverageSentinel,
  verifyPresentationCoverage,
  verifyPresentationProfiles,
} from './macos-launcher-coverage.mjs';

function target(name, type, path, source) {
  return { name, type, module_type: 'SwiftTarget', path, sources: [source] };
}

const fixtureSource = 'Tests/PresentationFixture/PresentationFixture.swift';
const presentationTarget = {
  ...target(
    'PresentationFixture',
    'executable',
    'Tests/PresentationFixture',
    'PresentationFixture.swift',
  ),
  target_dependencies: ['LauncherPresentation', 'LaunchContract'],
  product_memberships: ['PresentationFixture'],
};

const packageDescription = {
  targets: [
    target('LaunchContract', 'library', '.', 'LaunchContract.swift'),
    target('LauncherEngine', 'library', 'Engine', 'Engine.swift'),
    target('LauncherPresentation', 'library', 'Presentation', 'PresentationSeams.swift'),
    target('LauncherEntry', 'executable', '.', 'Entry.swift'),
    target('LauncherInstaller', 'library', 'Installer/Core', 'Installer.swift'),
    target('InstallerEntry', 'executable', 'Installer', 'Entry.swift'),
    target('EngineTests', 'test', 'Tests/Engine', 'Test.swift'),
    {
      ...target('LauncherPresentationTests', 'test', 'Tests/Presentation', 'Test.swift'),
      target_dependencies: ['LaunchContract', 'LauncherPresentation'],
    },
    presentationTarget,
  ],
};

const tracked = new Set([
  'LaunchContract.swift',
  'Engine/Engine.swift',
  'Presentation/PresentationSeams.swift',
  'Entry.swift',
  'Installer/Core/Installer.swift',
  'Installer/Entry.swift',
  fixtureSource,
  'Tests/Engine/Test.swift',
]);

const root = '/runner/work/GraphGoblin/apps/macos-launcher';

function summary(covered, count = 10) {
  return {
    lines: { covered, count },
    regions: { covered, count },
    branches: { covered: 0, count: 0 },
  };
}

function exported(files) {
  return {
    type: 'llvm.coverage.json.export',
    version: '2.0.1',
    data: [
      {
        files: files.map(([filename, coverage]) => ({ filename, summary: coverage })),
      },
    ],
  };
}

function fixture() {
  const sources = productionInventory(packageDescription, tracked);
  const sourceDigests = new Map([
    ['LaunchContract.swift', '60cde1d6d8d64bfe42b316b174c70c7d71f5fea1070c8f27cc0fb78aaff75fdc'],
    [
      'Presentation/PresentationSeams.swift',
      '870aeff6f1eda291bd9532b1c401569ede7c1f9e548464f3b12807512a5e3201',
    ],
  ]);
  const entries = [
    'Engine/Engine.swift',
    'Entry.swift',
    'Installer/Core/Installer.swift',
    'Installer/Entry.swift',
  ];
  return {
    sources,
    sourceDigests,
    baseline: new Map(entries.map((name) => [name, summary(0)])),
    observed: new Map(entries.map((name) => [name, summary(9)])),
  };
}

describe('production Swift inventory', () => {
  it('matches all six production targets and ignores test sources', () => {
    const sources = productionInventory(packageDescription, tracked);
    expect(sources.size).toBe(6);
    expect(sources.has(fixtureSource)).toBe(false);
    expect(sources.get('Entry.swift')).toBe('LauncherEntry');
    expect(sources.get('Installer/Entry.swift')).toBe('InstallerEntry');
  });

  it('rejects a production source absent from the package description', () => {
    expect(() =>
      productionInventory(packageDescription, new Set([...tracked, 'Engine/New.swift'])),
    ).toThrow('Tracked Swift production source absent from SwiftPM: Engine/New.swift');
  });

  it('rejects an untracked SwiftPM input and a missing or duplicate target', () => {
    expect(() => productionInventory(packageDescription, new Set([fixtureSource]))).toThrow(
      'Untracked',
    );
    const withoutEntry = packageDescription.targets.filter(({ name }) => name !== 'LauncherEntry');
    expect(() => productionInventory({ targets: withoutEntry }, tracked)).toThrow(
      'Missing Swift production target',
    );
    const duplicate = [...packageDescription.targets, packageDescription.targets[0]];
    expect(() => productionInventory({ targets: duplicate }, tracked)).toThrow(
      'Unexpected Swift production target',
    );
    expect(() => productionInventory({}, tracked)).toThrow('SwiftPM target list is missing');
  });
});

describe('test-only presentation executable and its collected counters', () => {
  it.each([
    ['wrong target type', { type: 'library' }],
    ['non-Swift target type', { module_type: 'ClangTarget' }],
    ['outside its exact test directory', { path: 'Presentation' }],
    ['invalid source list', { sources: null }],
    ['missing source', { sources: [] }],
    ['other source', { sources: ['Entry.swift'] }],
    ['unapproved extra source', { sources: ['PresentationFixture.swift', 'Extra.swift'] }],
    ['invalid dependency list', { target_dependencies: null }],
    ['missing dependencies', { target_dependencies: [] }],
    [
      'extra dependency',
      { target_dependencies: ['LaunchContract', 'LauncherPresentation', 'LauncherEngine'] },
    ],
    ['wrong first dependency', { target_dependencies: ['LauncherEngine', 'LauncherPresentation'] }],
    ['wrong second dependency', { target_dependencies: ['LaunchContract', 'LauncherEngine'] }],
    ['external product dependency', { product_dependencies: ['External'] }],
    ['shipping product membership', { product_memberships: ['GraphGoblin'] }],
  ])('rejects fixture metadata with %s', (_label, change) => {
    const targets = packageDescription.targets.map((row) =>
      row === presentationTarget ? { ...row, ...change } : row,
    );
    expect(() => productionInventory({ targets }, tracked)).toThrow(
      'Unexpected PresentationFixture executable metadata',
    );
  });

  it('rejects missing or duplicate fixture targets and an untracked fixture source', () => {
    const withoutFixture = packageDescription.targets.filter((row) => row !== presentationTarget);
    const duplicate = [...packageDescription.targets, presentationTarget];
    for (const targets of [withoutFixture, duplicate]) {
      expect(() => productionInventory({ targets }, tracked)).toThrow(
        'Expected one test-only PresentationFixture target',
      );
    }
    expect(() =>
      productionInventory(
        packageDescription,
        new Set([...tracked].filter((path) => path !== fixtureSource)),
      ),
    ).toThrow('Unexpected PresentationFixture executable metadata');
  });

  it('refuses production fixture dependencies and rejects another test executable', () => {
    for (const field of ['target_dependencies', 'product_dependencies']) {
      const invalid = packageDescription.targets.map((row) =>
        row.name === 'LauncherEntry' ? { ...row, [field]: ['PresentationFixture'] } : row,
      );
      expect(() => productionInventory({ targets: invalid }, tracked)).toThrow(
        'Swift production target cannot depend on PresentationFixture',
      );
    }
    const unknown = target('OtherTestExecutable', 'executable', 'Tests/Other', 'Main.swift');
    expect(() =>
      productionInventory({ targets: [...packageDescription.targets, unknown] }, tracked),
    ).toThrow('Unexpected Swift production target: OtherTestExecutable');
  });

  it('requires exactly the four scenario profile names', () => {
    const names = [
      'progress-menu-quit.profraw',
      'failure-ok.profraw',
      'panel-quit-grace.profraw',
      'cancelled.profraw',
    ];
    expect(() => verifyPresentationProfiles(names)).not.toThrow();
    expect(() => verifyPresentationProfiles(names.slice(1))).toThrow('four distinct');
    expect(() => verifyPresentationProfiles([...names, 'extra.profraw'])).toThrow('four distinct');
    expect(() => verifyPresentationProfiles([names[1], ...names.slice(1)])).toThrow(
      'four distinct',
    );
  });

  it('requires child counters in real production composition rather than test fixture code', () => {
    const entry = 'Presentation/LauncherPresentationEntry.swift';
    const testEntry = new Map([[fixtureSource, summary(9)]]);
    expect(() => verifyPresentationCoverage(testEntry)).toThrow(
      'did not record production composition',
    );
    expect(() => verifyPresentationCoverage(new Map([[entry, summary(0)]]))).toThrow(
      'did not record production composition',
    );
    const row = summary(6);
    row.regions.covered = 0;
    expect(() => verifyPresentationCoverage(new Map([[entry, row]]))).toThrow(
      'did not record production composition',
    );
    expect(() => verifyPresentationCoverage(new Map([[entry, summary(6)]]))).not.toThrow();
  });
});

it('validates a raw child export through the native Node module entry point', () => {
  const module = new URL('./macos-launcher-coverage.mjs', import.meta.url).href;
  const report = exported([
    [root + '/Presentation/LauncherPresentationEntry.swift', summary(8)],
    [root + '/' + fixtureSource, summary(10)],
  ]);
  const stdout = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        'const { coverageRows, verifyPresentationProfiles, verifyPresentationCoverage } = await import(process.argv[1]);',
        'const rows = coverageRows(JSON.parse(process.argv[2]), process.argv[3]);',
        'verifyPresentationProfiles(process.argv.slice(4));',
        'verifyPresentationCoverage(rows);',
        'process.stdout.write(JSON.stringify([...rows.keys()]));',
      ].join('\n'),
      module,
      JSON.stringify(report),
      root,
      'cancelled.profraw',
      'failure-ok.profraw',
      'panel-quit-grace.profraw',
      'progress-menu-quit.profraw',
    ],
    { encoding: 'utf8', timeout: 15_000 },
  );
  expect(JSON.parse(stdout)).toEqual(['Presentation/LauncherPresentationEntry.swift']);
});

describe('LLVM export checks', () => {
  it('keeps zero-hit production mappings and discards test and generated paths', () => {
    const rows = coverageRows(
      exported([
        [root + '/Entry.swift', summary(0)],
        [root + '/Tests/Engine/Test.swift', summary(10)],
        [root + '/' + fixtureSource, summary(10)],
        ['/runner/work/GraphGoblin/.tmp/generated.swift', summary(10)],
      ]),
      root,
    );
    expect([...rows]).toEqual([['Entry.swift', summary(0)]]);
  });

  it('rejects duplicate normalized paths, unbound filenames and malformed record shapes', () => {
    expect(() =>
      coverageRows(
        exported([
          [root + '/Entry.swift', summary(0)],
          [root + '/Engine/../Entry.swift', summary(10)],
        ]),
        root,
      ),
    ).toThrow('Duplicate LLVM source mapping');
    expect(() => coverageRows(exported([['Entry.swift', summary(0)]]), root)).toThrow(
      'Unbound LLVM',
    );
    expect(() => coverageRows({}, root)).toThrow('Unexpected LLVM coverage export structure');
    expect(() => coverageRows(exported([[root + '/Entry.swift', {}]]), root)).toThrow(
      'Invalid LLVM',
    );
    for (const covered of [-1, 11, 0.1]) {
      expect(() =>
        coverageRows(exported([[root + '/Entry.swift', summary(covered)]]), root),
      ).toThrow('Invalid LLVM lines counts');
    }
  });
});

describe('Swift native coverage policy', () => {
  it('requires both metrics, keeps executable entries in the denominator and records declarations', () => {
    const input = fixture();
    const pass = checkCoverage(input);
    expect(pass).toMatchObject({
      meetsThreshold: true,
      totals: { lines: { covered: 36, count: 40 }, regions: { covered: 36, count: 40 } },
      nativeBranchesAvailable: false,
    });
    expect(pass.files).toContainEqual(
      expect.objectContaining({
        path: 'LaunchContract.swift',
        mapping: 'declaration-only',
      }),
    );
    expect(pass.files).toContainEqual(
      expect.objectContaining({
        path: 'Installer/Entry.swift',
        mapping: 'executable',
      }),
    );
    const row = input.observed.get('Installer/Entry.swift');
    row.regions.covered = 8;
    expect(checkCoverage(input).meetsThreshold).toBe(false);
    row.regions.covered = 9;
    row.lines.covered = 0;
    expect(checkCoverage(input).meetsThreshold).toBe(false);
  });

  it('includes synthesized declaration mappings when actually present', () => {
    const input = fixture();
    input.baseline.set('Presentation/PresentationSeams.swift', summary(0));
    input.observed.set('Presentation/PresentationSeams.swift', summary(10));
    expect(checkCoverage(input).files).toContainEqual(
      expect.objectContaining({
        path: 'Presentation/PresentationSeams.swift',
        mapping: 'executable',
      }),
    );
  });

  it('rejects missing entries and declaration source drift', () => {
    const input = fixture();
    input.observed.delete('Entry.swift');
    expect(() => checkCoverage(input)).toThrow('LLVM coverage source set changed: Entry.swift');
    input.baseline.delete('Entry.swift');
    expect(() => checkCoverage(input)).toThrow(
      'No executable mapping or verified declaration-only source: Entry.swift',
    );
    input.baseline.set('Entry.swift', summary(0));
    input.observed.set('Entry.swift', summary(9));
    input.sourceDigests.set('LaunchContract.swift', 'different-source');
    expect(() => checkCoverage(input)).toThrow(
      'No executable mapping or verified declaration-only source: LaunchContract.swift',
    );
  });

  it('rejects denominator drift, nonzero baselines and noninventory mappings', () => {
    const input = fixture();
    input.baseline.set('Entry.swift', summary(1));
    expect(() => checkCoverage(input)).toThrow('baseline/observed denominator');
    input.baseline.set('Entry.swift', summary(0, 11));
    expect(() => checkCoverage(input)).toThrow('baseline/observed denominator');
    input.baseline.set('Other.swift', summary(0));
    expect(() => checkCoverage(input)).toThrow('outside the production inventory');
  });

  it('reports branch counters when the compiler emits them and refuses an empty package', () => {
    const input = fixture();
    input.baseline.get('Entry.swift').branches = { count: 2, covered: 0 };
    input.observed.get('Entry.swift').branches = { count: 2, covered: 1 };
    expect(checkCoverage(input).nativeBranchesAvailable).toBe(true);
    expect(() =>
      checkCoverage({ ...input, sources: new Map(), baseline: new Map(), observed: new Map() }),
    ).toThrow('Empty Swift coverage denominator');
  });
});

function sentinelFixture() {
  return {
    left: new Map([['Shared.swift', summary(8)]]),
    right: new Map([['Shared.swift', summary(8)]]),
    combined: new Map([
      ['Shared.swift', summary(10)],
      ['Untouched.swift', summary(0)],
      ['Left.swift', summary(8)],
      ['Right.swift', summary(8)],
    ]),
    rightUnrun: new Map([['Right.swift', summary(0)]]),
  };
}

describe('hosted coverage toolchain sentinel', () => {
  it('requires a real union, one shared denominator and preserved zero-hit code', () => {
    expect(() => verifyCoverageSentinel(sentinelFixture())).not.toThrow();
  });

  it.each([
    ['duplicated denominator', 'combined', 'Shared.swift', summary(20, 20)],
    ['missing complementary hits', 'combined', 'Shared.swift', summary(8)],
    ['left-alone cold', 'left', 'Shared.swift', summary(0)],
    ['right-alone cold', 'right', 'Shared.swift', summary(0)],
    ['left-alone already complete', 'left', 'Shared.swift', summary(10)],
    ['right-alone already complete', 'right', 'Shared.swift', summary(10)],
    ['missing cold entry', 'rightUnrun', 'Right.swift', undefined],
    ['zero denominator cold entry', 'rightUnrun', 'Right.swift', summary(0, 0)],
    ['cold entry unexpectedly hot', 'rightUnrun', 'Right.swift', summary(1)],
    ['untouched mapping lost', 'combined', 'Untouched.swift', undefined],
    ['untouched mapping unexpectedly hot', 'combined', 'Untouched.swift', summary(1)],
    ['left entry lost', 'combined', 'Left.swift', undefined],
    ['right entry lost', 'combined', 'Right.swift', undefined],
  ])('rejects invalid sentinel evidence for %s', (_label, report, path, row) => {
    const input = sentinelFixture();
    input[report].set(path, row);
    expect(() => verifyCoverageSentinel(input)).toThrow('LLVM sentinel');
  });
});
