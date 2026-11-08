import { DevicesPage } from '../chat/DevicesPage.js';
import { useOwnerChatClient } from './useOwnerChatClient.js';
export function ChatDevicesPage() {
  return <DevicesPage client={useOwnerChatClient()} />;
}
