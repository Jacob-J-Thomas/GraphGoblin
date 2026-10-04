import { secrets } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../api/context.js';
import { keys, useSecrets } from '../../api/queries.js';
import { QueryState } from '../../components/status.js';
import {
  Button,
  Card,
  ConfirmAction,
  FieldGroup,
  HelpText,
  Input,
  Label,
} from '../../components/ui/index.js';
import { formatDateTime } from '../../lib/utils.js';
import { LIST_ROW, MutationError, useInvalidate } from '../shared.js';

/** The API's rule for secret names (PUT /secrets/{name}). */
const SECRET_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

/** Write-only secrets: set a value under a name, list the names, delete them. */
export function SecretsSection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const query = useSecrets();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const set = useMutation({
    mutationFn: () => secrets.set(client, name, value),
    onSuccess: () => {
      setValue('');
      setName('');
      invalidate(keys.secrets);
    },
  });
  const nameInvalid = name !== '' && !SECRET_NAME.test(name);
  return (
    <Card title="Secrets">
      <div className="grid gap-4">
        <HelpText>Values are write-only: they are never shown again.</HelpText>
        <form
          className="flex flex-wrap items-start gap-3"
          aria-label="Set secret"
          onSubmit={(e) => {
            e.preventDefault();
            set.mutate();
          }}
        >
          <FieldGroup className="w-[260px]">
            <Label htmlFor="secret-name">Name</Label>
            <Input
              id="secret-name"
              className="font-mono text-sm"
              value={name}
              aria-invalid={nameInvalid}
              aria-describedby="secret-name-hint"
              onChange={(e) => setName(e.target.value)}
            />
            <HelpText id="secret-name-hint" tone={nameInvalid ? 'bad' : 'muted'}>
              A letter, then letters, digits, _ . or - (up to 128).
            </HelpText>
          </FieldGroup>
          <FieldGroup className="w-[260px]">
            <Label htmlFor="secret-value">Value</Label>
            <Input
              id="secret-value"
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </FieldGroup>
          <Button
            type="submit"
            className="mt-[23px]"
            disabled={!name || nameInvalid || !value || set.isPending}
          >
            Set secret
          </Button>
        </form>
        <MutationError error={set.error} />
        <QueryState query={query} what="Secrets">
          {(items) => (
            <ul className="text-sm">
              {items.map((s) => (
                <li key={s.name} className={LIST_ROW}>
                  <span>
                    <code>{s.name}</code>{' '}
                    <span className="text-xs text-muted">
                      updated {formatDateTime(s.updatedAt)}
                    </span>
                  </span>
                  <ConfirmAction
                    name={s.name}
                    accessibleName={`Delete secret ${s.name}`}
                    consequences={
                      <>
                        <p>
                          Webhook triggers using this secret will answer 503 HOOK_NOT_READY. Webhook
                          return channels will lose their signing secret and send unsigned
                          deliveries.
                        </p>
                        <p>
                          Script env values written as <code>secret:{s.name}</code> will fail with
                          SECRET_MISSING.
                        </p>
                        {s.name === 'jev-api-key' ? (
                          <p>
                            Removing jev-api-key turns Jev decisions off until the key is set again.
                          </p>
                        ) : null}
                      </>
                    }
                    onConfirm={async () => {
                      await secrets.remove(client, s.name);
                      await queryClient.invalidateQueries({ queryKey: keys.secrets });
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </div>
    </Card>
  );
}
