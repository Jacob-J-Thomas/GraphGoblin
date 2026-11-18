import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const port = 63652;
const helper = pathToFileURL(resolve('apps/api/src/testing/api-port.ts')).href;
const { setApiPortRoot, reserveApiPort } = await import(helper);
setApiPortRoot(root);
let outcome;
try {
  const acquired = await reserveApiPort(port, 1);
  await acquired.release();
  outcome = { operation: 'grant' };
} catch (error) {
  outcome = { code: error.code, syscall: error.syscall, path: error.path };
}
console.log(JSON.stringify(outcome));
if (!['EACCES', 'EPERM'].includes(outcome.code) || outcome.syscall !== 'mkdir' || outcome.path !== join(root, String(port)))
  process.exitCode = 1;
