const fs = require('node:fs');
const path = require('node:path');
const web = path.join(process.cwd(), 'apps/web');
const e2e = path.join(web, 'e2e');
const serverSource = fs.readFileSync(path.join(e2e, 'server.ts'), 'utf8');
const server = serverSource
  .replace("const url = await app.app.listen({ host: '127.0.0.1', port: 0 });", "const url = await app.app.listen({ host: '127.0.0.1', port: 5770 });")
  .replace("controlServer.listen(0, '127.0.0.1', done)", "controlServer.listen(5771, '127.0.0.1', done)");
if (server === serverSource || !server.includes('controlServer.listen(5771')) throw new Error('port replacements failed');
fs.writeFileSync(path.join(e2e, 'gg-chore-web-server.ts'), server);
fs.writeFileSync(path.join(e2e, 'gg-chore-web-global-setup.ts'), fs.readFileSync(path.join(e2e, 'global-setup.ts'), 'utf8').replace("'e2e/server.ts'", "'e2e/gg-chore-web-server.ts'"));
fs.writeFileSync(path.join(web, 'gg-chore-web-playwright.config.ts'), `import config from './playwright.config.js';
export default {
  ...config,
  globalSetup: './e2e/gg-chore-web-global-setup.ts',
  retries: 0,
  outputDir: ${JSON.stringify(path.join(process.env.TEMP, 'gg-chore-web-browser-results'))},
};
`);
