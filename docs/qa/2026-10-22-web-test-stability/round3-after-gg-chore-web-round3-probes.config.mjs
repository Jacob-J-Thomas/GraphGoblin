import fs from 'node:fs';
import base from "<USERPROFILE>/source/repos/GraphGoblin/.claude/worktrees/codex-chore-web-test-stability/apps/web/vitest.config.ts";
export default {
  ...base,
  root: "<USERPROFILE>/source/repos/GraphGoblin/.claude/worktrees/codex-chore-web-test-stability/apps/web",
  cacheDir: "<USERPROFILE>/AppData/Local/Temp/gg-chore-web-round3-probe-cache",
  plugins: [...base.plugins, {
    name: 'controlled-public-dependency-timing', enforce: 'pre',
    load(id) {
      if (id.endsWith('/src/editor/EditorPage.test.tsx')) {
        const dependency = `
// Diagnostic only: real storage deletion, delayed through the public dependency.
vi.mock('../drafts/local-drafts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../drafts/local-drafts.js')>();
  return {...actual, clearSetAsideDraft: async (...args: Parameters<typeof actual.clearSetAsideDraft>) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    return actual.clearSetAsideDraft(...args);
  }};
});
`;
        return fs.readFileSync(id, 'utf8') + dependency;
      }
      if (id.endsWith('/src/styles/code-theme.test.ts')) {
        let code = fs.readFileSync(id, 'utf8').replace("afterEach, describe, expect, it", "afterEach, describe, expect, it, vi");
        const start = "  const view = new EditorView({\n    state: EditorState.create({ doc, extensions: [codeTheme, language] }),\n    parent,\n  });";
        const replacement = `  let clock = Date.now();
  const slowClock = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
  let view: EditorView;
  try {
    view = new EditorView({
      state: EditorState.create({ doc, extensions: [codeTheme, language] }),
      parent,
    });
  } finally {
    slowClock.mockRestore();
  }`;
        code = code.replaceAll('\r\n', '\n');
        if (!code.includes(start)) throw new Error('Missing constructor marker');
        return code.replace(start, replacement);
      }
    },
  }],
  test: {...base.test, include: ['src/editor/EditorPage.test.tsx', 'src/styles/code-theme.test.ts'], testNamePattern: 'keeps a set-aside device copy|colours JSON keys', coverage: {...base.test.coverage, enabled: false}},
};
