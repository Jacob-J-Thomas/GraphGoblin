import { useState } from 'react';
import { useApiKeyStore } from '../api/api-key.js';
import { VoiceSetupSheet } from '../settings/VoiceSetupSheet.js';
import { Link } from 'react-router';
import { ChatSurface } from '../chat/ChatSurface.js';
import { Icon } from '../components/icons/index.js';
import { buttonStyles } from '../components/ui/index.js';
import { OwnerChatSummary } from './OwnerChatSummary.js';
import { useOwnerChatClient } from './useOwnerChatClient.js';

export function ChatPage() {
  const client = useOwnerChatClient();
  const rejected = useApiKeyStore((state) => state.rejected);
  const [voiceOpen, setVoiceOpen] = useState(false);
  if (rejected) return null;
  return (
    <>
      <ChatSurface
        client={client}
        storageKey="graphgoblin.owner.chat.v1"
        owner
        ownerSummary={(loopId) => <OwnerChatSummary loopId={loopId} />}
        onSetupVoice={() => setVoiceOpen(true)}
        headerActions={
          <Link to="/chat/devices" className={buttonStyles({ variant: 'outline', size: 'sm' })}>
            <Icon name="device" />
            Devices
          </Link>
        }
      />
      <VoiceSetupSheet
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onSaved={() => window.dispatchEvent(new Event('graphgoblin:chat-readiness-changed'))}
      />
    </>
  );
}
