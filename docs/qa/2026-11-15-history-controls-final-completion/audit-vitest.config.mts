import base from 'C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin/apps/web/vitest.config.ts';

const web = 'C:/Users/98jak/.codex/worktrees/gg-20261114-history-controls/GraphGoblin/apps/web';
const audit = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/review-208-history/final-audit-5a316';

export default {
  ...base,
  root: web,
  cacheDir: `${audit}/vite-cache`,
  resolve: {
    ...base.resolve,
    alias: [
      { find: /^react$/, replacement: `${web}/node_modules/react/index.js` },
      { find: /^react\/jsx-runtime$/, replacement: `${web}/node_modules/react/jsx-runtime.js` },
      { find: /^react\/jsx-dev-runtime$/, replacement: `${web}/node_modules/react/jsx-dev-runtime.js` },
      { find: /^@testing-library\/react$/, replacement: `${web}/node_modules/@testing-library/react/dist/index.js` },
      { find: /^vitest$/, replacement: `${web}/node_modules/vitest/dist/index.js` },
    ],
  },
  test: {
    ...base.test,
    include: [`${audit}/audit-lifecycle.test.tsx`],
  },
};
