import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../api/context.js';
import { Button, Card, HelpText } from '../../components/ui/index.js';
import { VoiceSetupSheet } from '../VoiceSetupSheet.js';
import { voiceErrorMessage, voiceSetup, voiceSetupKey } from '../voice-client.js';

/** Setup and provider routing belong to the gateway owner, never to a paired device. */
export function VoiceSection() {
  const client = useApi();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: voiceSetupKey,
    queryFn: ({ signal }) => voiceSetup.get(client, signal),
  });
  return (
    <Card id="voice" title="Voice">
      <div className="grid gap-3">
        {query.data ? (
          <>
            <p className="text-sm">
              {query.data.config.enabled
                ? query.data.route.ready && query.data.route.route === 'local'
                  ? 'Transcription route: on this gateway.'
                  : query.data.route.ready && query.data.route.route === 'cloud'
                    ? 'Transcription route: OpenAI.'
                    : 'Voice connection saved. A successful test is still needed.'
                : 'Voice isn’t set up yet.'}
            </p>
            <HelpText>
              {query.data.config.cloudFallbackAllowed
                ? 'Cloud fallback is allowed. OpenAI receives audio when that route is selected and bills your provider account.'
                : 'Automatic cloud fallback is off.'}{' '}
              Each gateway and device loop needs its own reviewed, published voice step.
            </HelpText>
          </>
        ) : query.isError ? (
          <HelpText role="alert" tone="bad">
            {voiceErrorMessage(query.error)}
          </HelpText>
        ) : (
          <p className="text-sm text-muted">Checking voice setup…</p>
        )}
        <div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {query.data?.config.enabled ? 'Manage voice' : 'Set up voice'}
          </Button>
        </div>
      </div>
      <VoiceSetupSheet open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}
