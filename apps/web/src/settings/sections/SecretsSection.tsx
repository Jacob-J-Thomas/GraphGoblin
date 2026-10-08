import { GraphGoblinApiError, secrets } from '@graphgoblin/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../api/context.js';
import { keys, refreshCatalogState, useClassifierModels, useSecrets } from '../../api/queries.js';
import { QueryState } from '../../components/status.js';
import {
  Button,
  Card,
  ConfirmAction,
  FIELD_ROW,
  FieldGroup,
  HelpText,
  Input,
  Label,
  RequiredNote,
} from '../../components/ui/index.js';
import { cn, formatDateTime } from '../../lib/utils.js';
import { LIST_ROW, MutationError, SECRETS_SECTION, useInvalidate } from '../shared.js';

/** The API's rule for secret names (PUT /secrets/{name}). */
const SECRET_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

/** The custom classifier models a secret authenticates, named in its deletion's consequences. */
function ClassifierUsers({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p>
      Classifier models using it as their bearer secret ({names.join(', ')}) will need a key:
      decisions using them fail with EVALUATION_UNAVAILABLE until the secret is restored.
    </p>
  );
}

/** Write-only secrets: set a value under a name, list the names, delete them. */
export function SecretsSection() {
  const client = useApi();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  const query = useSecrets();
  const classifiers = useClassifierModels();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const set = useMutation({
    mutationFn: () => secrets.set(client, name, value),
    onSuccess: () => {
      setValue('');
      setName('');
      invalidate(keys.secrets);
      // A classifier's configured state, and the editor's checks of it, follow its secret.
      void refreshCatalogState(queryClient);
    },
  });
  const nameInvalid = name !== '' && !SECRET_NAME.test(name);
  return (
    <Card id={SECRETS_SECTION} title="Secrets">
      <div className="grid gap-4">
        <HelpText>Values are write-only: they are never shown again.</HelpText>
        <form
          className={cn(FIELD_ROW, 'items-start')}
          aria-label="Set secret"
          onSubmit={(e) => {
            e.preventDefault();
            set.mutate();
          }}
        >
          <RequiredNote className="basis-full" />
          <FieldGroup className="w-[260px]">
            <Label htmlFor="secret-name" required>
              Name
            </Label>
            <Input
              id="secret-name"
              className="font-mono text-sm"
              value={name}
              aria-required
              aria-invalid={nameInvalid}
              aria-describedby="secret-name-hint"
              onChange={(e) => setName(e.target.value)}
            />
            {/* Keyed by state: when the name breaks the rule, the rule mounts again as an alert. */}
            <HelpText
              key={nameInvalid ? 'invalid' : 'valid'}
              id="secret-name-hint"
              role={nameInvalid ? 'alert' : undefined}
              tone={nameInvalid ? 'bad' : 'muted'}
            >
              A letter, then letters, digits, _ . or - (up to 128).
            </HelpText>
          </FieldGroup>
          <FieldGroup className="w-[260px]">
            <Label htmlFor="secret-value" required>
              Value
            </Label>
            <Input
              id="secret-value"
              type="password"
              autoComplete="off"
              aria-required
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
                    onDismiss={(error) => {
                      if (error instanceof GraphGoblinApiError && error.status === 404)
                        return Promise.all([
                          queryClient.invalidateQueries({ queryKey: keys.secrets }),
                          refreshCatalogState(queryClient),
                        ]);
                    }}
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
                        <ClassifierUsers
                          names={(classifiers.data ?? [])
                            .filter((c) => c.source === 'custom' && c.secretRef === s.name)
                            .map((c) => c.displayName)}
                        />
                        {s.name === 'jev-api-key' ? (
                          <p>
                            Removing jev-api-key turns Jev decisions off until the key is set again.
                            If GG_JEV_API_KEY is set, startup re-seeds the deleted secret at the
                            next server start.
                          </p>
                        ) : null}
                      </>
                    }
                    onConfirm={async () => {
                      await secrets.remove(client, s.name);
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: keys.secrets }),
                        refreshCatalogState(queryClient),
                      ]);
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
