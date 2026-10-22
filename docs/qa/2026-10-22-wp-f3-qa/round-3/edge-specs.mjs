import { command, newStore, launch, stop, removeStore, save, assert, head } from './qa-lib.mjs';
const data = await newStore('edge-specs');
let server;
const result = { head };
try {
  server = await launch(data);
  Object.assign(
    result,
    await command(
      'pnpm.cmd --filter @graphgoblin/web exec playwright test --config ../../docs/qa/2026-10-22-wp-f3-qa/round-3/edge.config.mjs unlimited-mode.spec.ts definition-pins.spec.ts editor-modal.spec.ts',
      {
        GG_E2E_BROWSER_CHANNEL: 'msedge',
        GG_E2E_BASE_URL: 'http://127.0.0.1:5905',
        GG_E2E_CONTROL_URL: 'http://127.0.0.1:5905',
      },
    ),
  );
  console.log(result.output);
  assert.equal(result.exitCode, 0);
} finally {
  if (server) result.lifecycle = await stop(server);
  result.cleanup = await removeStore(data, true);
  await save('edge-specs-results.json', result);
}
