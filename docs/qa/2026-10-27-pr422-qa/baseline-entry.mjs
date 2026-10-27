import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
register('./baseline-loader.mjs', import.meta.url);
const { main } = await import(
  pathToFileURL(path.join(process.env.GG_QA_ROOT, 'baseline-main/apps/api/dist/main.js')).href
);
await main();
