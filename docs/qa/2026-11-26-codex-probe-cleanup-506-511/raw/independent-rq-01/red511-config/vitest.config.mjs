// Red control for #511: the pre-fix live.test.ts (byte copy from 4e1037c9) collected by the
// package's Vitest against the worktree's adapters source. Only import specifiers are aliased.
export default {
  resolve: {
    conditions: ['development'],
    alias: [
      { find: /^\.\/adapters\.js$/, replacement: 'G:/ggq/gg-fu-codex-cleanup-20261124/GraphGoblin/packages/adapter-codex/src/adapters.ts' },
      { find: /^vitest$/, replacement: 'G:/ggq/gg-fu-codex-cleanup-20261124/GraphGoblin/node_modules/.pnpm/vitest@5.0.3_@types+node@22_8cb3c428779bce02ab47fd7b0887ed53/node_modules/vitest/dist/index.js' },
    ],
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node', pool: 'forks', clearMocks: true, restoreMocks: true },
};
