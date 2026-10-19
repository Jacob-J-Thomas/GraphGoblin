import { usePreflight } from '../../api/queries.js';
import type { HarnessPreflightItem } from '../../api/queries.js';
import { Icon } from '../../components/icons/index.js';
import { QueryState } from '../../components/status.js';
import { Badge, Card } from '../../components/ui/index.js';

function ClaudePreflight({ item }: { item: HarnessPreflightItem }) {
  return (
    <div className="mt-2 grid gap-2 text-xs text-muted">
      {item.authMethod === 'claude.ai' && item.authenticated ? (
        <p>Signed in with Claude.ai.</p>
      ) : null}
      {item.models?.length ? (
        <ul aria-label="Claude model support" className="grid gap-1">
          {item.models.map((model) => (
            <li key={model.model}>
              <code>{model.model}</code> <Badge tone="good">listed by adapter</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        Adapter model listings do not confirm account access. Preflight never starts a model turn.
      </p>
    </div>
  );
}

/** Is each configured harness installed and signed in? */
export function PreflightSection() {
  const query = usePreflight();
  return (
    <Card title="Harness preflight">
      {query.isFetching ? <p role="status">Checking harness readiness.</p> : null}
      {query.isError ? <p role="status">Harness readiness unknown. Retry preflight.</p> : null}
      <QueryState query={query} what="Preflight">
        {(items) => (
          <ul className="grid gap-2 text-sm">
            {items.map((p) => {
              const state = query.isFetching
                ? 'checking'
                : query.isError || query.fetchStatus === 'paused'
                  ? 'unknown'
                  : p.state;
              const ready = state === 'ready';
              return (
                <li key={p.harness}>
                  <Badge
                    tone={
                      ready ? 'good' : state === 'checking' || state === 'unknown' ? 'warn' : 'bad'
                    }
                  >
                    <Icon
                      name={ready ? 'succeeded' : state === 'checking' ? 'running' : 'failed'}
                    />
                    {state}
                  </Badge>{' '}
                  <code>{p.harness}</code> {p.version ? `v${p.version}` : ''}
                  {p.problems.length > 0 ? (
                    <ul className="mt-1 list-disc pl-5 text-xs text-status-bad-fg">
                      {p.problems.map((problem, i) => (
                        <li key={i}>{problem}</li>
                      ))}
                    </ul>
                  ) : null}
                  {p.harness === 'claude' ? <ClaudePreflight item={p} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}

/** How to install the app; the shell then opens offline. */
export function InstallSection() {
  return (
    <Card title="Install">
      <p className="text-sm text-muted">
        GraphGoblin is a progressive web app: use your browser&apos;s “Install app” action to open
        it in its own window. The app shell then opens offline; anything that needs the API shows an
        offline notice.
      </p>
    </Card>
  );
}
