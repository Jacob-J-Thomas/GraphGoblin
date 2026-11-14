import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [worktree, store, ready] = process.argv.slice(2);
const { main } = await import(pathToFileURL(join(worktree,'apps/api/dist/main.js')));
const { app } = await main();
const port = app.server.address().port;
if(!Number.isInteger(port)||[4747,4748].includes(port))throw Error('Unexpected fixture bind port');
await writeFile(ready,JSON.stringify({pid:process.pid,origin:'http://127.0.0.1:'+port,node:process.version,store}));
