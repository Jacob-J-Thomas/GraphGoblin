import { apiKeys } from '@graphgoblin/api-client';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useApiKeyStore } from '../../api/api-key.js';
import { useApi } from '../../api/context.js';
import { keys, useApiKeys } from '../../api/queries.js';
import { QueryState } from '../../components/status.js';
import { Alert, Badge, Button, Card, FieldGroup, Input, Label } from '../../components/ui/index.js';
import { LIST_ROW, MutationError, useInvalidate } from '../shared.js';

/** API keys for scripts and other clients: create one (the token is shown once), revoke it. */
export function ApiKeysSection() {
  const client = useApi();
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
  const revoke = useMutation({
    mutationFn: (id: string) => apiKeys.revoke(client, id),
    onSuccess: () => invalidate(keys.apiKeys),
  });
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
        <MutationError error={create.error ?? revoke.error} />
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => revoke.mutate(k.id)}
                      aria-label={`Revoke ${k.label}`}
                    >
                      Revoke
                    </Button>
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
