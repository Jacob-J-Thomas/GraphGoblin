import type { QaTemplateSettings } from '@graphgoblin/contracts';
import { NativeCommands, nativeExecutable, type CommandRunner } from './process.js';
import { DiskSupportStorage } from './storage.js';
import type { ArtifactFiles } from './review-storage.js';
import { CliQaGithub, trustedQaPr, type QaMetadataPort } from './qa-client.js';
import { ImplementationRepository } from './repository.js';
import { QaPrivateEnvelopeSchema, type QaPrivateEnvelope } from './qa-envelope.js';
import { QaActionSchema, qaBlocked } from './qa-protocol.js';
import { SupportFailure } from './protocol.js';

export interface QaMetadataDependencies {
  github: QaMetadataPort;
  commands: CommandRunner;
  files: ArtifactFiles;
  git: string;
}
export type QaMetadataFactory = (settings: QaTemplateSettings) => Promise<QaMetadataDependencies>;
export async function nativeQaMetadata(
  settings: QaTemplateSettings,
): Promise<QaMetadataDependencies> {
  const commands = new NativeCommands();
  return {
    commands,
    files: new DiskSupportStorage(),
    git: await nativeExecutable('git'),
    github: new CliQaGithub(commands, await nativeExecutable('gh'), settings.repository.path),
  };
}
/** Node execution has no effect-port factory or capability override. Poll is metadata only. */
export class NativeQaDiscovery {
  constructor(private readonly metadata: QaMetadataFactory = nativeQaMetadata) {}
  async execute(actionInput: string, input: QaPrivateEnvelope): Promise<unknown> {
    const envelope = QaPrivateEnvelopeSchema.parse(input),
      action = QaActionSchema.parse(actionInput);
    if (action !== 'poll') return qaBlocked('TEMPLATE_ISOLATION_UNAVAILABLE');
    if (envelope.identity.kind !== 'poll') return qaBlocked('QA_POLL_IDENTITY_REFUSED');
    const deps = await this.metadata(envelope.settings);
    await new ImplementationRepository(
      envelope.settings,
      deps.commands,
      deps.files,
      deps.git,
    ).assert();
    const items = [];
    for (const candidate of await deps.github.mergedCandidates(envelope.settings)) {
      try {
        const current = await trustedQaPr(deps.github, envelope.settings, candidate.pullRequest);
        if (current.mergeSha !== candidate.mergeSha) continue;
        items.push({
          id: current.mergeSha,
          payload: { pullRequest: current.pr.number, mergeSha: current.mergeSha },
        });
      } catch (error) {
        if (
          !(error instanceof SupportFailure) ||
          !['QA_MERGE_REFUSED', 'QA_ISSUE_LINK_REFUSED'].includes(error.code)
        )
          throw error;
      }
    }
    return { items };
  }
}
