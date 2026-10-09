import { join, resolve } from 'node:path';
import type { ImplementationTemplateSettings } from '@graphgoblin/contracts';
import type { CommandRunner } from './process.js';
import type { SupportStorage, Journal } from './storage.js';
import { contained } from './storage.js';
import { ShaSchema, fail } from './protocol.js';

const normalize = (path: string) => {
  const normalized = resolve(path).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};
export class ImplementationRepository {
  readonly root: string;
  readonly metadata: string;
  readonly worktrees: string;
  readonly hooks: string;
  constructor(
    readonly settings: ImplementationTemplateSettings,
    private readonly runner: CommandRunner,
    private readonly storage: SupportStorage,
    private readonly program: string,
  ) {
    this.root = resolve(settings.repository.path);
    this.metadata = join(this.root, '.git', 'graphgoblin', 'implementation');
    this.worktrees = join(this.root, '.graphgoblin-worktrees');
    this.hooks = join(this.metadata, 'empty-hooks');
  }
  private async raw(
    args: readonly string[],
    cwd = this.root,
    allowFailure = false,
  ): Promise<string> {
    const result = await this.runner.run({
      program: this.program,
      credentialContext: true,
      args: [
        '--no-optional-locks',
        '-c',
        'core.hooksPath=' + this.hooks,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'protocol.file.allow=never',
        ...args,
      ],
      cwd,
      env: { GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 30000,
      maxBytes: 65536,
    });
    if (result.termination !== 'confirmed') fail('PROCESS_TERMINATION_UNCONFIRMED');
    if (result.timedOut || result.overflow || (!allowFailure && result.exitCode !== 0))
      fail('GIT_OPERATION_FAILED');
    return result.exitCode === 0 ? result.stdout.trim() : '';
  }
  async assert(cwd = this.root): Promise<void> {
    if (
      normalize(await this.storage.canonical(this.root)) !== normalize(this.root) ||
      normalize(await this.storage.canonical(join(this.root, '.git'))) !==
        normalize(join(this.root, '.git'))
    )
      fail('REPOSITORY_ROOT_CHANGED');
    if (cwd !== this.root && !contained(this.worktrees, cwd)) fail('WORKSPACE_OUTSIDE_ROOT');
    if (normalize(await this.storage.canonical(cwd)) !== normalize(cwd))
      fail('WORKSPACE_LINK_REFUSED');
    const top = await this.raw(['rev-parse', '--show-toplevel'], cwd);
    const common = await this.raw(['rev-parse', '--git-common-dir'], cwd);
    const origin = await this.raw(['remote', 'get-url', 'origin'], cwd);
    const repository = (
      this.settings.repository.owner +
      '/' +
      this.settings.repository.name
    ).toLowerCase();
    const remote = /^(?:https:\/\/github\.com\/|git@github\.com:)([^\s]+?)(?:\.git)?$/.exec(
      origin,
    )?.[1];
    if (
      normalize(top) !== normalize(cwd) ||
      normalize(resolve(cwd, common)) !== normalize(join(this.root, '.git')) ||
      remote?.toLowerCase() !== repository
    )
      fail('REPOSITORY_IDENTITY_CHANGED');
  }
  async git(args: readonly string[], cwd = this.root, allowFailure = false): Promise<string> {
    await this.assert(cwd);
    return this.raw(args, cwd, allowFailure);
  }
  async initialize(): Promise<void> {
    await this.assert();
    await this.storage.directory(this.root, this.metadata);
    await this.storage.directory(this.metadata, this.hooks);
    await this.storage.directory(this.root, this.worktrees);
  }
  journal(runId: string): string {
    return join(this.metadata, runId + '.json');
  }
  workspace(runId: string, task?: number): string {
    return join(this.worktrees, runId, task === undefined ? 'issue' : 'task-' + task);
  }
  async remoteHead(branch: string): Promise<string | undefined> {
    const value = await this.git(['ls-remote', '--refs', 'origin', 'refs/heads/' + branch]);
    if (!value) return undefined;
    const lines = value.split(/\r?\n/);
    if (lines.length !== 1 || lines[0]?.split(/\s+/)[1] !== 'refs/heads/' + branch)
      fail('REMOTE_REF_CONFLICT');
    return ShaSchema.parse(lines[0].split(/\s+/)[0]);
  }
  async ensureWorkspace(branch: string, cwd: string, base: string): Promise<void> {
    if (!contained(this.worktrees, cwd)) fail('WORKSPACE_OUTSIDE_ROOT');
    await this.storage.directory(this.worktrees, resolve(cwd, '..'));
    if (await this.storage.exists(cwd)) {
      await this.assert(cwd);
      if ((await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)) !== branch)
        fail('WORKSPACE_BRANCH_CHANGED');
      return;
    }
    const existing = await this.git(
      ['rev-parse', '--verify', 'refs/heads/' + branch],
      this.root,
      true,
    );
    if (existing && existing !== base) fail('LOCAL_BRANCH_CONFLICT');
    await this.git([
      'worktree',
      'add',
      ...(existing ? [] : ['-b', branch]),
      cwd,
      existing ? branch : base,
    ]);
    await this.assert(cwd);
  }
  async head(cwd: string) {
    return ShaSchema.parse(await this.git(['rev-parse', 'HEAD'], cwd));
  }
  async commit(
    state: Journal,
    cwd: string,
    message: string,
    save: () => Promise<void>,
  ): Promise<string> {
    const head = await this.head(cwd);
    if (state.commit) {
      const intent = state.commit;
      if (intent.cwd !== cwd) fail('COMMIT_INTENT_CONFLICT');
      if (head !== intent.parent) {
        const parent = await this.git(['rev-parse', 'HEAD^'], cwd);
        const tree = await this.git(['rev-parse', 'HEAD^{tree}'], cwd);
        const subject = await this.git(['show', '-s', '--format=%s', 'HEAD'], cwd);
        if (parent !== intent.parent || tree !== intent.tree || subject !== intent.message)
          fail('COMMIT_RECONCILIATION_REFUSED');
        delete state.commit;
        await save();
        return head;
      }
    } else {
      if (!(await this.git(['status', '--porcelain', '--untracked-files=all'], cwd))) return head;
      await this.git(['add', '--all', '--', '.'], cwd);
      state.commit = {
        cwd,
        parent: head,
        tree: ShaSchema.parse(await this.git(['write-tree'], cwd)),
        message,
      };
      await save();
    }
    const intent = state.commit;
    if ((await this.git(['write-tree'], cwd)) !== intent.tree) fail('COMMIT_INDEX_CHANGED');
    await this.git(['commit', '--no-gpg-sign', '-m', intent.message], cwd);
    const committed = await this.head(cwd);
    if (
      (await this.git(['rev-parse', 'HEAD^'], cwd)) !== intent.parent ||
      (await this.git(['rev-parse', 'HEAD^{tree}'], cwd)) !== intent.tree ||
      (await this.git(['show', '-s', '--format=%s', 'HEAD'], cwd)) !== intent.message
    )
      fail('COMMIT_RECONCILIATION_REFUSED');
    delete state.commit;
    await save();
    return committed;
  }
  async merge(state: Journal, source: string, save: () => Promise<void>): Promise<string> {
    const head = await this.head(state.cwd);
    state.merge ??= { parent: head, source };
    await save();
    if (state.merge.source !== source) fail('MERGE_INTENT_CONFLICT');
    if (head === state.merge.parent) {
      await this.git(
        [
          'merge',
          '--no-ff',
          '--no-edit',
          '-m',
          'Merge implementation task for #' + state.issue,
          source,
        ],
        state.cwd,
      );
    } else {
      const parents = (await this.git(['show', '-s', '--format=%P', 'HEAD'], state.cwd)).split(' ');
      if (parents.length !== 2 || parents[0] !== state.merge.parent || parents[1] !== source)
        fail('MERGE_RECONCILIATION_REFUSED');
    }
    delete state.merge;
    await save();
    return this.head(state.cwd);
  }
}
