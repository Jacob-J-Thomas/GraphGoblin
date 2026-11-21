import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { WorkingDirectorySpec } from '@graphgoblin/contracts';
import { renderTemplate } from '@graphgoblin/domain';
import type { WorkspacePort } from '@graphgoblin/engine';

/**
 * Working directories on the local filesystem. Fixed paths are used as given, templates are
 * rendered against the thread view, and temporary directories live under `<dataDir>/workspaces/<runId>`.
 */
export class FsWorkspace implements WorkspacePort {
  constructor(private readonly dataDir: string) {}

  async resolve(
    spec: WorkingDirectorySpec,
    view: Record<string, unknown>,
    runId: string,
  ): Promise<string> {
    let dir: string;
    switch (spec.kind) {
      case 'fixed':
        dir = spec.path;
        break;
      case 'template': {
        dir = (await renderTemplate(spec.template, view)).trim();
        if (dir === '') throw new Error('working directory template rendered to an empty path');
        break;
      }
      case 'temp':
        dir = join(this.dataDir, 'workspaces', runId);
        break;
    }
    const absolute = resolve(dir);
    await mkdir(absolute, { recursive: true });
    return absolute;
  }

  async writeFile(dir: string, path: string, content: string): Promise<string> {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(dir, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
    return absolute;
  }
}
