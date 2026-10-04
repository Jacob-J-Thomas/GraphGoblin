import { apiKeys, GraphGoblinApiError } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApiKeyStore } from '../../api/api-key.js';
import { useApi } from '../../api/context.js';
import { keys, useApiKeys } from '../../api/queries.js';
import { QueryState } from '../../components/status.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmAction,
  FieldGroup,
  Input,
  Label,
} from '../../components/ui/index.js';
import { LIST_ROW, MutationError, useInvalidate } from '../shared.js';

/** API keys for scripts and other clients: create one (the token is shown once), revoke it. */
export function ApiKeysSection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const query = useApiKeys();
  const [label, setLabel] = useState('');
  const create = useMutation({
    mutationFn: () => apiKeys.create(client, { label, scopes: ['*'] }),
    onSuccess: () => {
      setLabel('');
      invalidate(keys.apiKeys);
    },
  });
  const stored = useApiKeyStore((s) => s.key);
  return (
    <Card title="API keys">
      <div className="grid gap-4">
        <form
          className="flex flex-wrap items-end gap-3"
          aria-label="Create API key"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <FieldGroup className="w-[260px]">
            <Label htmlFor="key-label">Label</Label>
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </FieldGroup>
          <Button type="submit" disabled={!label || create.isPending}>
            Create key
          </Button>
        </form>
        {create.data ? (
          <Alert tone="info" title="Copy this key now. It is shown only once.">
            <code className="break-all" data-testid="new-api-key">
              {create.data.token}
            </code>
          </Alert>
        ) : null}
        <MutationError error={create.error} />
        <QueryState query={query} what="API keys">
          {(items) => (
            <ul className="text-sm">
              {items.map((k) => (
                <li key={k.id} className={LIST_ROW}>
                  <span>
                    {k.label} <span className="text-xs text-muted">({k.scopes.join(', ')})</span>{' '}
                    {k.revokedAt ? <Badge>revoked</Badge> : null}
                  </span>
                  {k.revokedAt ? null : (
                    <ConfirmAction
                      action="revoke"
                      name={k.label}
                      accessibleName={`Revoke ${k.label}`}
                      onDismiss={(error) => {
                        if (error instanceof GraphGoblinApiError && error.status === 404)
                          return queryClient.invalidateQueries({ queryKey: keys.apiKeys });
                      }}
                      consequences={
                        <>
                          <p>Clients using this API key will get 401 immediately.</p>
                          {stored ? (
                            <p>
                              This browser sends an API key. If you revoke that key, this browser
                              will lose access and show the API key panel, where you must enter
                              another valid key.
                            </p>
                          ) : null}
                        </>
                      }
                      onConfirm={() => apiKeys.revoke(client, k.id)}
                      onConfirmed={() => queryClient.invalidateQueries({ queryKey: keys.apiKeys })}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </div>
    </Card>
  );
}

/** The key this browser sends (GG_REQUIRE_API_KEY mode). The value itself is never shown. */
export function BrowserKeySection() {
  const stored = useApiKeyStore((s) => s.key);
  const forget = useApiKeyStore((s) => s.forget);
  return (
    <Card title="This browser's API key">
      {stored ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>A key is stored in this browser and sent with every request.</span>
          <Button size="sm" variant="outline" onClick={forget}>
            Forget key
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          No key is stored. The app asks for one if the server requires it.
        </p>
      )}
    </Card>
  );
}
