import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const {defineConfig}=createRequire(resolve(process.env.GG_AUDIT_REPO,'apps/web/package.json'))('@playwright/test');
export default defineConfig({testDir:dirname(fileURLToPath(import.meta.url)),testMatch:'native-browser.spec.mjs',workers:1,retries:0,reporter:'list',outputDir:resolve(dirname(fileURLToPath(import.meta.url)),'native-browser-results'),use:{channel:'msedge',headless:true,trace:'off'}});
