import { Link } from 'react-router';
import { ChatSurface } from '../chat/ChatSurface.js';
import { Icon } from '../components/icons/index.js';
import { buttonStyles } from '../components/ui/index.js';
import { useOwnerChatClient } from './useOwnerChatClient.js';

export function ChatPage() {
  const client = useOwnerChatClient();
  return (
    <ChatSurface
      client={client}
      storageKey="graphgoblin.owner.chat.v1"
      owner
      headerActions={
        <Link to="/chat/devices" className={buttonStyles({ variant: 'outline', size: 'sm' })}>
          <Icon name="device" />
          Devices
        </Link>
      }
    />
  );
}
