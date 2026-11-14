/* global console, process, require */
// Use a CommonJS preload so an unsupported older Node can emit the version diagnostic.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { statSync } = require('node:fs');

const [major, minor, patch] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 22 || (minor === 22 && patch < 2)) {
  console.error(
    'GraphGoblin requires Node 22.22.2 or later in major 22. Set GG_NODE_BINARY to that Node executable or launch Claude Code with the supported Node first on PATH.',
  );
  process.exit(1);
}

const entry = process.argv[1];
if (!entry || !statSync(entry, { throwIfNoEntry: false })?.isFile()) {
  console.error(
    'GraphGoblin could not find its MCP entry at "%s". Run pnpm build in the current checkout, then reload its plugin artifact or replace the installed copy.',
    entry ?? '',
  );
  process.exit(1);
}
