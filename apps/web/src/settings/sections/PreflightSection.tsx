import { CODEX_PLUGIN_OBSERVABILITY_NOTICE } from '@graphgoblin/domain';
import { usePreflight } from '../../api/queries.js';
import type { HarnessPreflightItem } from '../../api/queries.js';
import { READINESS_LABEL, type ReadinessView } from '../../api/readiness.js';
import { Icon, type IconName } from '../../components/icons/index.js';
import { QueryState } from '../../components/status.js';
import { Badge, Button, Card, type Tone } from '../../components/ui/index.js';

/** Fixable configuration is bad; a pending, undecided or temporary condition is a warning. */
const STATE_TONE: Record<ReadinessView, Tone> = {
  ready: 'good',
  checking: 'info',
  unknown: 'warn',
  quota: 'warn',
  transport: 'warn',
  'cli-missing': 'bad',
  'cli-incompatible': 'bad',
  auth: 'bad',
};
const TONE_ICON: Record<Tone, IconName> = {
  good: 'succeeded',
  info: 'running',
  warn: 'alert',
  bad: 'failed',
  neutral: 'info',
};

/** The state's label on its tone and icon; the state itself is `data-state`. */
function ReadinessBadge({ state }: { state: ReadinessView }) {
  const tone = STATE_TONE[state];
  return (
    <Badge tone={tone} data-state={state}>
      <Icon name={TONE_ICON[tone]} />
      {READINESS_LABEL[state]}
    </Badge>
  );
}

function ClaudePreflight({ item }: { item: HarnessPreflightItem }) {
  return (
    <div className="grid gap-2 text-xs text-muted">
      {item.authMethod === 'claude.ai' && item.authenticated ? (
        <p>Signed in with Claude.ai.</p>
      ) : null}
      {item.models?.length ? (
        <ul aria-label="Claude model support" className="grid gap-1">
          {item.models.map((model) => (
            <li key={model.model} className="flex flex-wrap items-center gap-2">
              <code>{model.model}</code> <Badge size="sm">listed by adapter</Badge>
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

/**
 * A `codex … list --json` command in the notice. Splitting on this capture group keeps each
 * command, at an odd index.
 */
const NOTICE_COMMAND = /(codex [a-z]+ list --json)/;

/**
 * What the Codex check leaves out (#442): it covers the CLI and its sign-in, not whether plugin
 * tools load in a worker. The shared notice is a fixed statement of scope in every state, muted
 * like Claude's listing note and never a problem, so the badge and any real problems keep their
 * meaning above it. Its commands are shown as code; the words stay exactly the shared text.
 */
function CodexPreflight() {
  return (
    <p className="text-xs text-muted">
      {CODEX_PLUGIN_OBSERVABILITY_NOTICE.split(NOTICE_COMMAND).map((part, i) =>
        i % 2 === 1 ? <code key={i}>{part}</code> : part,
      )}
    </p>
  );
}

/**
 * Is each configured harness installed and signed in? A background check keeps the last result
 * on screen and says "Rechecking…" beside Retry; a failed request replaces the list with its error.
 */
export function PreflightSection() {
  const query = usePreflight();
  const rechecking = query.isFetching && query.data !== undefined;
  const offline = query.fetchStatus === 'paused' && query.data !== undefined;
  const status = rechecking ? 'Rechecking…' : offline ? 'Offline; showing the last check.' : '';
  return (
    <Card
      title="Harness preflight"
      actions={
        <>
          <span role="status" className={status ? 'text-xs text-muted' : 'sr-only'}>
            {status}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry preflight
          </Button>
        </>
      }
    >
      <QueryState query={query} what="Preflight">
        {(items) => (
          <ul className="grid gap-4 text-sm">
            {items.map((p) => (
              <li key={p.harness} className="grid gap-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <ReadinessBadge state={p.state} />
                  <code>{p.harness}</code>
                  {p.version ? <span className="text-xs text-muted">v{p.version}</span> : null}
                </div>
                {p.problems.length > 0 ? (
                  <ul
                    className={
                      STATE_TONE[p.state] === 'bad'
                        ? 'list-disc pl-5 text-xs text-status-bad-fg'
                        : 'list-disc pl-5 text-xs text-status-warn-fg'
                    }
                  >
                    {p.problems.map((problem, i) => (
                      <li key={i}>{problem}</li>
                    ))}
                  </ul>
                ) : null}
                {p.harness === 'claude' ? <ClaudePreflight item={p} /> : null}
                {p.harness === 'codex' ? <CodexPreflight /> : null}
              </li>
            ))}
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
