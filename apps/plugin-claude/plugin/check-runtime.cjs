/* global console, process, require */
// eslint-disable-next-line @typescript-eslint/no-require-imports
var fs = require('fs');

var version = /^(\d+)\.(\d+)\.(\d+)$/.exec(process.versions.node);
if (
  !version ||
  Number(version[1]) !== 22 ||
  Number(version[2]) < 22 ||
  (Number(version[2]) === 22 && Number(version[3]) < 2)
) {
  console.error(
    'GraphGoblin requires Node 22.22.2 or later in major 22. Set GG_NODE_BINARY to that Node executable or launch Claude Code with the supported Node first on PATH.',
  );
  process.exit(1);
}

var entry = process.argv[1];
var entryIsFile = false;
if (entry) {
  try {
    entryIsFile = fs.statSync(entry).isFile();
  } catch {
    entryIsFile = false;
  }
}
if (!entryIsFile) {
  console.error(
    'GraphGoblin could not find its MCP entry at "%s". Run pnpm build in the current checkout, then reload its plugin artifact or replace the installed copy.',
    entry || '',
  );
  process.exit(1);
}
