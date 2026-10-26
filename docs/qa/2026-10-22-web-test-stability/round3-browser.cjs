const fs = require('node:fs');
const path = require('node:path');
const web = path.join(process.cwd(), 'apps/web');
const e2e = path.join(web, 'e2e');
const destination = path.join(process.env.TEMP, 'gg-chore-web-round3-after');
const files = [path.join(e2e, 'gg-chore-web-round3-server.ts'), path.join(e2e, 'gg-chore-web-round3-global-setup.ts'), path.join(web, 'gg-chore-web-round3-playwright.config.ts'), path.join(e2e, 'gg-chore-web-round3-test-app.ts')];
if (process.argv.includes('--clean-files')) {
  // Only the explicitly named generated files; never delete a directory.
  for (const file of files) if (fs.existsSync(file)) fs.unlinkSync(file);
} else {
  let server = fs.readFileSync(path.join(e2e, 'server.ts'), 'utf8');
  server = server.replace("from '@graphgoblin/api/testing'", "from './gg-chore-web-round3-test-app.js'")
    .replace("mkdtemp, readFile, rm, writeFile", "mkdtemp, readFile, writeFile")
    .replaceAll("'gg-e2e-live-'", "'gg-chore-web-round3-live-'")
    .replaceAll("await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);", '// Temporary data directories are retained for the orchestrator.');
  let testApp = fs.readFileSync(path.join(process.cwd(), 'apps/api/src/testing/test-app.ts'), 'utf8')
    .replace('mkdtemp, rm', 'mkdtemp')
    .replaceAll("'gg-api-'", "'gg-chore-web-round3-api-'")
    .replaceAll("await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);", '// Temporary data directories are retained for the orchestrator.');
  for (const specifier of ['../app.js', '../config.js', '../container.js', '../types.js']) testApp = testApp.replaceAll("'" + specifier + "'", "'@graphgoblin/api'");
  testApp = testApp.replace("'./fake-classifier.js'", "'@graphgoblin/api/testing'");
  for (const [before, after] of [
    ["app.app.listen({ host: '127.0.0.1', port: 0 })", "app.app.listen({ host: '127.0.0.1', port: 5770 })"],
    ["controlServer.listen(0, '127.0.0.1', done)", "controlServer.listen(5771, '127.0.0.1', done)"],
    ["live.listen({ host: '127.0.0.1', port: 0 })", "live.listen({ host: '127.0.0.1', port: 5772 })"],
  ]) {
    if (!server.includes(before)) throw new Error('Missing port binding: ' + before);
    server = server.replace(before, after);
  }
  const setup = fs.readFileSync(path.join(e2e, 'global-setup.ts'), 'utf8').replace("'e2e/server.ts'", "'e2e/gg-chore-web-round3-server.ts'");
  const config = `import config from './playwright.config.js';\nexport default {...config, globalSetup: './e2e/gg-chore-web-round3-global-setup.ts', retries: 0, outputDir: ${JSON.stringify(path.join(process.env.TEMP, 'gg-chore-web-round3-browser-results'))}};\n`;
  for (const [i, text] of [server, setup, config, testApp].entries()) {
    fs.writeFileSync(files[i], text);
    fs.writeFileSync(path.join(destination, path.basename(files[i])), text);
  }
}
console.log(JSON.stringify({mode: process.argv.includes('--clean-files') ? 'removed explicit files' : 'prepared', ports: [5770, 5771, 5772], retries: 0}));
