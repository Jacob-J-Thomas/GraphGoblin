import base from '<USERPROFILE>/source/repos/GraphGoblin/.claude/worktrees/codex-chore-web-test-stability/apps/web/vitest.config.ts';
export default {
  ...base,
  plugins: [...base.plugins, {
    name: 'slow-public-loop-response',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/editor/EditorPage.test.tsx')) return;
      const marker = '    renderApp(`/loops/${loop.id}/edit`, api);';
      if (!source.includes(marker)) throw new Error('Missing first editor render');
      return source.replace(marker, `    api.override('GET /loops/:id', async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      return api.builtIn(call);
    });
${marker}`);
    },
  }],
};
