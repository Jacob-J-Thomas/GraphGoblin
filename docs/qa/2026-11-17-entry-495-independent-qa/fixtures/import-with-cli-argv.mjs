import { pathToFileURL } from 'node:url';
const [modulePath, ...args] = process.argv.slice(2);
process.argv = [process.execPath, modulePath, ...args];
const namespace = await import(pathToFileURL(modulePath).href);
console.log(JSON.stringify(Object.keys(namespace).sort()));
