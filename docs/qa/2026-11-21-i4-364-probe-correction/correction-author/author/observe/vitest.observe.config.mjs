// Isolated observation config (evidence only). Resolves workspace packages from their TypeScript
// source like the repository's shared config, and runs only the driver in this folder.
export default {
  root: 'G:/ggq/qa-scratch/i4-364-probe-correction-01/observe',
  resolve: { conditions: ['development'] },
  test: { include: ['observe-364.test.ts'], globals: true, environment: 'node', pool: 'forks' },
};
