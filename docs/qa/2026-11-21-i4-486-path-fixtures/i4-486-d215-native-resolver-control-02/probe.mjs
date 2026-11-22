import { realpathSync, statSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const path = tmpdir();
const observation = { node:process.version, cwd:process.cwd(), input:path, exists:statSync(path).isDirectory(), synchronous:realpathSync(path), native:realpathSync.native(path), promises:await realpath(path) };
console.log(JSON.stringify(observation));
if (observation.native !== observation.promises || observation.synchronous === observation.native || observation.synchronous.toLowerCase() !== observation.native.toLowerCase()) process.exitCode=1;
