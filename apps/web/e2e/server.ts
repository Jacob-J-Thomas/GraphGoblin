/**
 * E2E backend: the real API in this process over an in-memory database with the fake harness
 * (`createTestApp`), serving the built web app from apps/web/dist through the static plugin
 * (GG_WEB_DIST). Listens on an ephemeral port and prints `GG_E2E_READY <url>`; writing anything to
 * stdin, or closing it, shuts it down cleanly.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestApp } from '@graphgoblin/api/testing';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error(
    `No web build at ${dist}. Run \`pnpm build\` (or \`pnpm --filter @graphgoblin/web build\`) first.`,
  );
  process.exit(1);
}

const app = await createTestApp({ env: { GG_WEB_DIST: dist } });
const address = await app.app.listen({ host: '127.0.0.1', port: 0 });
console.log(`GG_E2E_READY ${address}`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await app.close();
  process.exit(0);
}
process.stdin.on('data', () => void stop());
process.stdin.on('end', () => void stop());
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
