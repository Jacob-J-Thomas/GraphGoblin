const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),web=path.join(root,'apps/web'),e2e=path.join(web,'e2e');
const evidence=path.join(root,'docs/qa/2026-10-22-web-test-stability');
let server=fs.readFileSync(path.join(e2e,'server.ts'),'utf8');
server=server.replace("import { createTestApp, startFakeClassifierEndpoint, type TestApp } from '@graphgoblin/api/testing';", "import { createTestApp, type TestApp } from '@graphgoblin/api/testing';\nimport { startFakeClassifierEndpoint } from './gg-chore-web-extra-classifier.js';");
server=server.replace('let nextInstanceId = 1;', `let nextInstanceId = 1;
let ggNextPort = 5772;
function ggTakePort(): number {
  if (ggNextPort > 5779) throw new Error('Reserved test port range exhausted');
  return ggNextPort++;
}
// The browser configuration runs one case at a time. Previous extra instances have
// finished their case; release their listeners before allocating the next pair.
async function ggReleaseExtras(): Promise<void> {
  for (const [id, instance] of instances) {
    if (id === 'main') continue;
    await instance.app.close();
    instances.delete(id);
    const index = apps.indexOf(instance.app);
    if (index >= 0) apps.splice(index, 1);
  }
  for (const fake of classifiers.values()) await fake.close();
  classifiers.clear();
  ggNextPort = 5772;
}`);
server=server.replace("  const id = options.id ?? 'e2e-instance-' + nextInstanceId++;", "  if (instances.size > 0) await ggReleaseExtras();\n  const id = options.id ?? 'e2e-instance-' + nextInstanceId++;");
server=server.replace("const url = await app.app.listen({ host: '127.0.0.1', port: 0 });", "const url = await app.app.listen({ host: '127.0.0.1', port: apps.length === 1 ? 5770 : ggTakePort() });");
server=server.replace("live.listen({ host: '127.0.0.1', port: 0 })", "live.listen({ host: '127.0.0.1', port: ggTakePort() })");
server=server.replace('const fake = await startFakeClassifierEndpoint();','const fake = await startFakeClassifierEndpoint(ggTakePort());');
server=server.replace("controlServer.listen(0, '127.0.0.1', done)","controlServer.listen(5771, '127.0.0.1', done)");
if(server.includes('port: 0')||server.includes('startFakeClassifierEndpoint();')||!server.includes('apps.length === 1 ? 5770'))throw new Error('Server port substitutions incomplete');
let classifier=fs.readFileSync(path.join(root,'apps/api/src/testing/fake-classifier.ts'),'utf8');
classifier=classifier.replace('export async function startFakeClassifierEndpoint()','export async function startFakeClassifierEndpoint(port: number)');
classifier=classifier.replace("server.listen(0, '127.0.0.1', resolve)","server.listen(port, '127.0.0.1', resolve)");
if(classifier.includes('server.listen(0,'))throw new Error('Classifier port substitution incomplete');
const setup=fs.readFileSync(path.join(e2e,'global-setup.ts'),'utf8').replace("'e2e/server.ts'","'e2e/gg-chore-web-extra-server.ts'");
const config=`import config from './playwright.config.js';
export default {
  ...config,
  globalSetup: './e2e/gg-chore-web-extra-setup.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: ${JSON.stringify(path.join(process.env.TEMP,'gg-chore-web-browser-extra-bounded-results'))},
};
`;
for(const [name,body,folder] of [['gg-chore-web-extra-server.ts',server,e2e],['gg-chore-web-extra-classifier.ts',classifier,e2e],['gg-chore-web-extra-setup.ts',setup,e2e],['gg-chore-web-extra.config.ts',config,web]]){
  fs.writeFileSync(path.join(folder,name),body);
  fs.writeFileSync(path.join(evidence,name),body);
}
console.log('Disposable browser fixtures: main 5770, control 5771, extra APIs/endpoints allocated within 5772..5779.');
