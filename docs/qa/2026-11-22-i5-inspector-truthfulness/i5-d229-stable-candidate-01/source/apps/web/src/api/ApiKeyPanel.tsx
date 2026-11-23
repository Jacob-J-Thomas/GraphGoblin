import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  FIELD_ROW,
  FieldGroup,
  Input,
  Label,
  RequiredNote,
} from '../components/ui/index.js';
import { cn } from '../lib/utils.js';
import { syncApiKeyAcrossTabs, useApiKeyStore } from './api-key.js';
import { keys } from './queries.js';

/**
 * Shown when the API answers 401: the server requires an API key (`GG_REQUIRE_API_KEY=true`) and
 * this browser has none, or the stored one was revoked. The key is kept in this browser only.
 */
export function ApiKeyPanel() {
  const rejected = useApiKeyStore((s) => s.rejected);
  const stored = useApiKeyStore((s) => s.key);
  const save = useApiKeyStore((s) => s.save);
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => syncApiKeyAcrossTabs(), []);
  // The same key accepted again after a rejection (#386) starts a new credential generation with an
  // unchanged key, which the key effect below does not see. Reads still pending were sent under the
  // retired generation, and a refetch would join a pending first read rather than replace it:
  // cancel them first, then read the active queries once under the accepted credentials, unless the
  // credentials changed again meanwhile (a rejection, replacement or forgetting is another
  // generation). Saving the key that is already accepted is no new generation and reads nothing.
  useEffect(
    () =>
      useApiKeyStore.subscribe((state, previous) => {
        if (!previous.rejected || state.rejected || !state.key || state.key !== previous.key)
          return;
        const { generation } = state;
        void queryClient.cancelQueries().then(async () => {
          if (useApiKeyStore.getState().generation === generation)
            await queryClient.invalidateQueries({}, { cancelRefetch: false });
        });
      }),
    [queryClient],
  );
  useEffect(() => {
    if (!rejected) return;
    let frame = 0;
    // A rejected-key panel can arrive while a revoke dialog still owns the modal top layer.
    const observer = new MutationObserver(() => requestFocus());
    const requestFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return;
        panelRef.current?.querySelector('input')?.focus();
        observer.disconnect();
      });
    };
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    requestFocus();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rejected]);
  const previousKeyRef = useRef(stored);
  useEffect(() => {
    if (previousKeyRef.current === stored) return;
    previousKeyRef.current = stored;
    // A new key: fetch everything again with it. A forgotten key: drop what was loaded with it,
    // so nothing keeps showing data this browser is no longer allowed to read.
    if (stored) {
      // The marker belongs to the credentials used for the response. Reset also cancels an
      // initial fetch, which invalidation alone leaves running when it has no data yet.
      void queryClient.resetQueries({ queryKey: keys.apiKeys });
      void queryClient.invalidateQueries();
    } else void queryClient.resetQueries();
  }, [stored, queryClient]);
  if (!rejected) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    save(value);
    setValue('');
  };
  return (
    <div ref={panelRef} className="mx-auto w-full max-w-[1240px] px-page pt-page">
      <Card title="API key required">
        <p className="mb-4 text-sm text-muted">
          {stored
            ? 'The API refused the key stored in this browser. It may have been revoked; enter another one.'
            : 'This GraphGoblin server requires an API key (Settings → API keys creates them). Enter one here; it is kept in this browser only.'}
        </p>
        <form className={cn(FIELD_ROW, 'items-end')} aria-label="Enter API key" onSubmit={submit}>
          <RequiredNote className="basis-full" />
          <FieldGroup className="max-w-lg min-w-60 flex-1">
            <Label htmlFor="api-key-input" required>
              API key
            </Label>
            <Input
              id="api-key-input"
              type="password"
              autoComplete="off"
              aria-required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="gg_…"
            />
          </FieldGroup>
          <Button type="submit" disabled={!value.trim()}>
            Use key
          </Button>
        </form>
      </Card>
    </div>
  );
}
