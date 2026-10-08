import { z } from 'zod';
import { resolveHarnessModel } from '@graphgoblin/domain';
import {
  TemplateRoleSelectionSchema,
  TemplatePrerequisiteReportSchema,
  TemplateSettingsSchemas,
  type Effort,
  type HarnessId,
  type TemplateManifest,
  type TemplatePrerequisiteCheck,
  type TemplatePrerequisiteReport,
  type TemplateSettings,
  type LoopDefinition,
  type HarnessDefaults,
} from '@graphgoblin/contracts';
import { claudeModelBlocked } from '@graphgoblin/infrastructure/claude';
import type { HarnessPort, ModelCatalogPort, ScriptPort, SecretsPort } from '@graphgoblin/engine';
import type { SqliteApiKeys } from '@graphgoblin/infrastructure/sqlite';

export interface PrerequisiteDeps {
  catalog: ModelCatalogPort;
  harnesses: Partial<Record<HarnessId, HarnessPort>>;
  scripts: ScriptPort;
  apiKeys: Pick<SqliteApiKeys, 'authenticate'>;
  secretsFor(ownerId: string): SecretsPort;
  supportAvailable(manifest: TemplateManifest): Promise<boolean>;
  defaults?: HarnessDefaults;
  ownerDefaults?(ownerId: string): Promise<HarnessDefaults>;
}
export class TemplatePrerequisites {
  constructor(private readonly deps: PrerequisiteDeps) {}
  private async roleReady(
    role: { harness: HarnessId; model: string; effort: Effort },
    access: 'read-only' | 'write',
  ): Promise<boolean> {
    const harness = this.deps.harnesses[role.harness];
    if (!harness || claudeModelBlocked(role.harness === 'claude' ? role.model : undefined))
      return false;
    try {
      const preflight = await harness.preflight();
      if (!preflight.ok || !preflight.authenticated) return false;
      const capability = preflight.models?.find((model) => model.model === role.model);
      if (
        preflight.models &&
        (!capability ||
          capability.admission !== 'supported' ||
          !capability.efforts.includes(role.effort))
      )
        return false;
      if (role.harness !== 'claude') return true;
      return (
        capability?.admission === 'supported' &&
        capability.efforts.includes(role.effort) &&
        !!preflight.supportedPolicies?.some(
          (policy) =>
            policy.sandbox === (access === 'read-only' ? 'read-only' : 'danger-full-access') &&
            policy.approval === 'never',
        )
      );
    } catch {
      return false;
    }
  }
  async defaults(manifest: TemplateManifest): Promise<TemplateSettings | null> {
    if (manifest.kind !== 'starter') return null;
    const entries = await this.deps.catalog.list();
    for (const model of [...entries].sort(
      (a, b) => Number(b.harness === 'codex') - Number(a.harness === 'codex'),
    )) {
      if (!model.enabled || (model.harness !== 'codex' && model.harness !== 'claude')) continue;
      for (const effort of new Set([model.defaultEffort, ...model.efforts])) {
        if (!model.efforts.includes(effort)) continue;
        const role = TemplateRoleSelectionSchema.parse({
          harness: model.harness,
          model: model.model,
          effort,
        });
        if (await this.roleReady(role, 'read-only'))
          return TemplateSettingsSchemas.starter.parse({
            kind: 'starter',
            roles: { assistant: role },
          });
      }
    }
    return null;
  }
  async checkCurrentRoles(
    ownerId: string,
    definition: LoopDefinition,
    id: string,
  ): Promise<TemplatePrerequisiteReport> {
    const catalog = await this.deps.catalog.list();
    const ownerDefaults = (await this.deps.ownerDefaults?.(ownerId)) ?? { byHarness: {} };
    let ready = true;
    for (const node of definition.nodes) {
      const requests: {
        harness: HarnessId;
        model?: string;
        effort?: Effort;
        access: 'read-only' | 'write';
      }[] = [];
      if (node.kind === 'inference')
        requests.push({
          harness: node.config.harness,
          ...(node.config.model !== undefined ? { model: node.config.model } : {}),
          ...(node.config.effort !== undefined ? { effort: node.config.effort } : {}),
          access: node.config.harnessOptions.sandbox === 'read-only' ? 'read-only' : 'write',
        });
      const evaluations =
        node.kind === 'decision'
          ? [node.config.evaluation]
          : node.kind === 'exit'
            ? node.config.criteria.flatMap((criterion) =>
                criterion.when === 'predicate' ? [criterion.evaluation] : [],
              )
            : [];
      for (const evaluation of evaluations)
        if (evaluation.kind === 'llm')
          requests.push({
            harness: evaluation.harness,
            ...(evaluation.model.mode === 'explicit' ? { model: evaluation.model.value } : {}),
            ...(evaluation.effort.mode === 'explicit' ? { effort: evaluation.effort.value } : {}),
            access: 'read-only',
          });
      for (const request of requests) {
        const resolution = resolveHarnessModel({
          ...request,
          loopDefaults: definition.settings.defaults,
          ownerDefaults,
          processDefaults: this.deps.defaults ?? { byHarness: {} },
          catalog,
        });
        ready &&=
          resolution.status === 'ready' &&
          (await this.roleReady(
            { harness: request.harness, model: resolution.model, effort: resolution.effort },
            request.access,
          ));
      }
    }
    return TemplatePrerequisiteReportSchema.parse({
      checks: [
        {
          id,
          label: 'Current configured roles',
          blocking: 'authoring',
          status: ready ? 'ok' : 'missing',
          message: ready
            ? 'The actual pinned role selections are ready.'
            : 'An actual pinned role selection or harness account is unavailable.',
          ...(!ready
            ? { remediation: 'Configure the pinned model, effort, and harness before running.' }
            : {}),
        },
      ],
      canInstantiate: ready,
      canRun: ready,
    });
  }
  async check(
    ownerId: string,
    manifest: TemplateManifest,
    settingsInput: unknown,
  ): Promise<TemplatePrerequisiteReport> {
    const parsed = TemplateSettingsSchemas[manifest.kind].safeParse(settingsInput);
    const checks: TemplatePrerequisiteCheck[] = [];
    if (!parsed.success)
      return TemplatePrerequisiteReportSchema.parse({
        checks: [
          {
            id: 'settings',
            label: 'Settings',
            status: 'missing',
            blocking: 'authoring',
            message: 'Complete valid settings for this template.',
            remediation: 'Choose all required roles and correct the settings fields.',
          },
        ],
        canInstantiate: false,
        canRun: false,
      });
    const settings = parsed.data;
    const catalog = await this.deps.catalog.list();
    for (const declaration of manifest.prerequisites) {
      let ok = false;
      let status: TemplatePrerequisiteCheck['status'] = 'missing';
      let message = 'This prerequisite is not configured.';
      let remediation = 'Configure this prerequisite and check again.';
      if (declaration.kind === 'role' && declaration.role) {
        const selection = TemplateRoleSelectionSchema.safeParse(
          Object.entries(settings.roles).find(([id]) => id === declaration.role)?.[1],
        );
        if (selection.success) {
          const role = selection.data;
          const entry = catalog.find(
            (item) => item.harness === role.harness && item.model === role.model,
          );
          const declarationRole = manifest.roles.find((item) => item.id === declaration.role);
          ok =
            !!entry?.enabled &&
            entry.efforts.includes(role.effort) &&
            !!declarationRole &&
            (await this.roleReady(role, declarationRole.access));
        }
        message = ok
          ? 'The selected role model, effort, and harness preflight are ready.'
          : 'The selected role model, effort, or harness account is unavailable.';
        remediation =
          'Choose an enabled supported model and effort, then configure the selected harness account.';
      } else if (declaration.kind === 'isolation') {
        status = 'unavailable';
        message = 'Production QA isolation is unavailable in this installation.';
        remediation =
          'This draft cannot run until production isolation is implemented; there is no override.';
      } else if (
        declaration.kind === 'secret' &&
        declaration.secretKey === 'supportReadKey' &&
        'supportReadKey' in settings
      ) {
        try {
          const value = await this.deps.secretsFor(ownerId).resolve(settings.supportReadKey);
          const key = value ? await this.deps.apiKeys.authenticate(value) : undefined;
          ok =
            !!key &&
            key.ownerId === ownerId &&
            key.scopes.length === 1 &&
            key.scopes[0] === 'runs:read';
        } catch {
          ok = false;
        }
        message = ok
          ? 'The support key is valid and has exactly runs:read.'
          : 'The support key is absent, revoked, or has the wrong owner or scopes.';
        remediation =
          'Store an existing revocable API key with exactly runs:read in the selected secret.';
      } else if (declaration.kind === 'support') {
        try {
          ok = await this.deps.supportAvailable(manifest);
        } catch {
          ok = false;
        }
        message = ok
          ? 'The installed support entry matches this template.'
          : 'The installed support entry is unavailable or stale.';
        remediation = 'Reinstall the matching package and instantiate a new template.';
      } else if (
        'repository' in settings &&
        (declaration.kind === 'repository' || declaration.kind === 'github')
      ) {
        const repo = settings.repository;
        const qualified = repo.owner + '/' + repo.name;
        const invoke = async (command: string, args: string[]) => {
          const result = await this.deps.scripts.run({
            command,
            args,
            cwd: repo.path,
            env: {},
            signal: new AbortController().signal,
            timeoutMs: 10_000,
            maxStdoutBytes: 8192,
          });
          if (result.exitCode !== 0 || result.timedOut || result.stdoutOverflow)
            throw new Error('preflight failed');
          return result.stdout.trim();
        };
        try {
          if (declaration.kind === 'repository') {
            const top = await invoke('git', ['rev-parse', '--show-toplevel']);
            const origin = await invoke('git', ['remote', 'get-url', 'origin']);
            const normalized = (value: string) =>
              value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
            const remote = /^(?:https:\/\/github\.com\/|git@github\.com:)([^\s]+?)(?:\.git)?$/.exec(
              origin,
            )?.[1];
            ok =
              normalized(top) === normalized(repo.path) &&
              remote?.toLowerCase() === qualified.toLowerCase();
          } else {
            await invoke('gh', ['auth', 'status']);
            const remote = z
              .strictObject({ nameWithOwner: z.string() })
              .parse(
                JSON.parse(
                  await invoke('gh', ['repo', 'view', qualified, '--json', 'nameWithOwner']),
                ),
              );
            ok = remote.nameWithOwner.toLowerCase() === qualified.toLowerCase();
          }
        } catch {
          ok = false;
        }
        message = ok
          ? 'The canonical repository prerequisite is ready.'
          : 'The repository path, origin, GitHub discovery, or authentication is unavailable.';
        remediation =
          'Configure the canonical GitHub repository and authenticate gh, then check again.';
      }
      checks.push({
        id: declaration.id,
        label: declaration.label,
        blocking: declaration.blocking,
        status: ok ? 'ok' : status,
        message,
        ...(!ok ? { remediation } : {}),
      });
    }
    return TemplatePrerequisiteReportSchema.parse({
      checks,
      canInstantiate: !checks.some(
        (check) => check.blocking === 'authoring' && check.status !== 'ok',
      ),
      canRun: checks.every((check) => check.status === 'ok'),
    });
  }
}
