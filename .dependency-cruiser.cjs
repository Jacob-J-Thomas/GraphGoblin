/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make packages impossible to reason about and to build in order.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-cross-package-relative-imports',
      severity: 'error',
      comment:
        'Packages reference each other only through their public @graphgoblin/* entry points, never through relative paths that reach into another package.',
      from: { path: '^(packages|apps)/([^/]+)/' },
      to: { path: '^(packages|apps)/([^/]+)/', pathNot: '^(packages|apps)/$2/' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)index\\.ts$', '\\.test\\.ts$', 'vitest\\.config\\.ts$'],
      },
      to: {},
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Production code may not import packages that are only declared as devDependencies.',
      from: { path: '^(packages|apps)/[^/]+/src/', pathNot: '\\.test\\.ts$|/test/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
