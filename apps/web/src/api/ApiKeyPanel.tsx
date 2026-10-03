import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Card, Input, Label } from '../components/ui.js';
import { useApiKeyStore } from './api-key.js';

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
  if (!rejected) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    save(value);
    setValue('');
    void queryClient.invalidateQueries();
  };
  return (
    <div className="p-4 pb-0">
      <Card title="API key required">
        <p className="mb-2 text-sm text-slate-700">
          {stored
            ? 'The API refused the key stored in this browser. It may have been revoked; enter another one.'
            : 'This GraphGoblin server requires an API key (Settings → API keys creates them). Enter one here; it is kept in this browser only.'}
        </p>
        <form className="flex items-end gap-2" aria-label="Enter API key" onSubmit={submit}>
          <div className="flex-1">
            <Label htmlFor="api-key-input">API key</Label>
            <Input
              id="api-key-input"
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="gg_…"
            />
          </div>
          <Button type="submit" disabled={!value.trim()}>
            Use key
          </Button>
        </form>
      </Card>
    </div>
  );
}
