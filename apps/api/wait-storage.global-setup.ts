import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

// Native SQLite handles can outlive client.close() until the fork exits on Windows.
// The parent owns this root and removes it after the test workers finish.
export default async function setup(project: TestProject) {
  const root = await mkdtemp(join(tmpdir(), 'gg-wp-c2-tests-'));
  project.provide('waitStorageRoot', root);
  return async () => {
    await rm(root, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    waitStorageRoot: string;
  }
}
