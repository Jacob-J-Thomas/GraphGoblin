const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd().replaceAll('\\', '/');
const config = path.join(process.cwd(), 'apps/web/gg-chore-web-round3-probes.config.mjs');
const source = `import fs from 'node:fs';
import base from ${JSON.stringify(root + '/apps/web/vitest.config.ts')};
export default {
  ...base,
  root: ${JSON.stringify(root + '/apps/web')},
  cacheDir: ${JSON.stringify(process.env.TEMP.replaceAll('\\', '/') + '/gg-chore-web-round3-probe-cache')},
  plugins: [...base.plugins, {
    name: 'controlled-public-dependency-timing', enforce: 'pre',
    load(id) {
      if (id.endsWith('/src/editor/EditorPage.test.tsx')) {
        const dependency = \`\n// Diagnostic only: real storage deletion, delayed through the public dependency.\nvi.mock('../drafts/local-drafts.js', async (importOriginal) => {\n  const actual = await importOriginal<typeof import('../drafts/local-drafts.js')>();\n  return {...actual, clearSetAsideDraft: async (...args: Parameters<typeof actual.clearSetAsideDraft>) => {\n    await new Promise(resolve => setTimeout(resolve, 200));\n    return actual.clearSetAsideDraft(...args);\n  }};\n});\n\`;
        return fs.readFileSync(id, 'utf8') + dependency;
      }
      if (id.endsWith('/src/styles/code-theme.test.ts')) {
        let code = fs.readFileSync(id, 'utf8').replace("afterEach, describe, expect, it", "afterEach, describe, expect, it, vi");
        const start = "  const view = new EditorView({\\n    state: EditorState.create({ doc, extensions: [codeTheme, language] }),\\n    parent,\\n  });";
        const replacement = \`  let clock = Date.now();\n  const slowClock = vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));\n  let view: EditorView;\n  try {\n    view = new EditorView({\n      state: EditorState.create({ doc, extensions: [codeTheme, language] }),\n      parent,\n    });\n  } finally {\n    slowClock.mockRestore();\n  }\`;
        code = code.replaceAll('\\r\\n', '\\n');
        if (!code.includes(start)) throw new Error('Missing constructor marker');
        return code.replace(start, replacement);
      }
    },
  }],
  test: {...base.test, include: ['src/editor/EditorPage.test.tsx', 'src/styles/code-theme.test.ts'], testNamePattern: 'keeps a set-aside device copy|colours JSON keys', coverage: {...base.test.coverage, enabled: false}},
};
`;
fs.writeFileSync(config, source);
fs.writeFileSync(path.join(process.env.TEMP, 'gg-chore-web-round3-probe-tasks.json'), JSON.stringify([
  'controlled-probes-selected=pnpm.cmd --filter @graphgoblin/web exec vitest run --config ' + config + ' --reporter=verbose',
]));
console.log(config);
