// Review probe config (#410 scan 1): the engine's own shared Vitest config, plus one external
// setup file and an external cache directory so nothing is written inside the checkout.
const sharedUrl =
  'file:///C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin/tooling/vitest.shared.mjs';
const { createVitestConfig } = await import(String(sharedUrl));

export default createVitestConfig({
  cacheDir: 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/review-410-opus-scan1/probe-old-source/cache',
  test: {
    setupFiles: [
      'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/review-410-opus-scan1/probe-old-source/old-source-emulation.setup.ts',
    ],
  },
});
