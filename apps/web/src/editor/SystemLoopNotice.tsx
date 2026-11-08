import type { LoopDefinitionInput, SystemChatBinding } from '@graphgoblin/contracts';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { systemChatIssues } from '@graphgoblin/domain';
import { SystemChatAudio } from './SystemChatAudio.js';
import { Link } from 'react-router';
import { Icon } from '../components/icons/index.js';
export function SystemLoopNotice({
  binding,
  version,
  definition,
  published,
  loopId,
}: {
  binding: SystemChatBinding;
  definition: LoopDefinitionInput;
  published: LoopDefinitionInput | undefined;
  loopId: string;
  version: number | undefined;
}) {
  const parsed = LoopDefinitionSchema.safeParse(definition);
  const hasIssues = parsed.success && systemChatIssues(parsed.data).length > 0;
  const gateway = binding.audience.kind === 'gateway';
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-default bg-surface-sunken px-4 py-2 text-sm text-muted">
      <Icon name="info" className="text-status-info-fg" />
      <p>
        System chat loop for{' '}
        {gateway
          ? 'Chat on this gateway'
          : `device ${binding.audience.kind === 'device' ? binding.audience.deviceId : ''}`}
        . Change the steps between the chat trigger and its exits; the trigger’s input and the chat
        response return stay fixed.{' '}
        {version
          ? `Published v${version} answers until you publish again.`
          : 'Nothing answers until you publish.'}
      </p>
      {hasIssues ? (
        <p>
          Fix these to publish. {gateway ? 'Chat' : 'This device'} keeps using{' '}
          {version ? `published v${version}.` : 'the published configuration when available.'}
        </p>
      ) : null}
      <Link
        to={
          gateway
            ? '/chat'
            : `/chat/devices#device-${binding.audience.kind === 'device' ? binding.audience.deviceId : ''}`
        }
      >
        {gateway ? 'Open Chat' : 'Manage device'}
      </Link>
      <SystemChatAudio
        definition={definition}
        published={published}
        version={version}
        loopId={loopId}
      />
    </div>
  );
}
