import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

// Native SQLite handles can outlive client.close() until the fork exits on Windows.
// The parent owns this root. Vitest's onClose runs after its worker pool closes;
// global-setup teardown runs before that and can still encounter locked files.
export default async function setup(project: TestProject) {
  const root = await mkdtemp(join(tmpdir(), 'gg-wp-c2-tests-'));
  project.provide('waitStorageRoot', root);
  project.vitest.onClose(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 10 });
  });
}

declare module 'vitest' {
  export interface ProvidedContext {
    waitStorageRoot: string;
  }
}
