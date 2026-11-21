import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    apiPortRoot: string;
  }
}

export default async function setup(project: TestProject) {
  const root = await mkdtemp(join(tmpdir(), 'gg-api-ports-'));
  project.provide('apiPortRoot', root);
  // Keep reservations until all workers close, including when a worker cannot clean up.
  project.vitest.onClose(() => rm(root, { recursive: true, force: true }));
}
