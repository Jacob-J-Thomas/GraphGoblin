import type { LoopRecord } from '@graphgoblin/contracts';
import { Link, useSearchParams } from 'react-router';
import { useLoops } from '../../api/queries.js';
import { Page, PageHeader } from '../../components/layout/index.js';
import { QueryState } from '../../components/status.js';
import {
  Alert,
  buttonStyles,
  Card,
  FieldGroup,
  HelpText,
  Label,
  Select,
} from '../../components/ui/index.js';
import { RunLauncher } from './RunLauncher.js';

/** Why the loop in the address cannot be started, if it cannot. */
function LoopProblem({ loopId, loop }: { loopId: string; loop: LoopRecord | undefined }) {
  if (!loop) {
    return (
      <Alert tone="warn" title="Loop not found">
        No loop has the id <code>{loopId}</code>. Choose a published loop above.
      </Alert>
    );
  }
  return (
    <Alert tone="warn" title={`“${loop.name}” has no published version`}>
      Runs start from a published version.{' '}
      <Link to={`/loops/${loop.id}/edit`}>Open it in the editor</Link> and publish it, then start it
      here.
    </Alert>
  );
}

/**
 * Start a run: choose a published loop, then its version, trigger, and input. This is the only
 * place the app starts runs (#46); the editor links here. The chosen loop lives in the address
 * (`/runs/new?loop=<loopId>`), so a link can preselect it and a reload keeps it.
 */
export function NewRunPage() {
  const [params, setParams] = useSearchParams();
  const loopId = params.get('loop') ?? '';
  const loopsQuery = useLoops();
  const choose = (id: string) => setParams(id ? { loop: id } : {}, { replace: true });
  return (
    <Page>
      <PageHeader
        title="New run"
        actions={
          <Link
            to={loopId ? `/runs?loop=${encodeURIComponent(loopId)}` : '/runs'}
            className={buttonStyles({ variant: 'ghost' })}
          >
            {loopId ? 'Runs of this loop' : 'All runs'}
          </Link>
        }
      />
      <Card>
        <QueryState query={loopsQuery} what="Loops">
          {(items) => {
            const published = items.filter((l) => l.currentVersionId);
            const loop = items.find((l) => l.id === loopId);
            // The loop's current published version, when it has one: then it can be started.
            const current = loop?.currentVersionId;
            return (
              <div className="grid gap-section">
                <FieldGroup className="max-w-[420px]">
                  <Label htmlFor="new-run-loop">Loop</Label>
                  <Select
                    id="new-run-loop"
                    value={current ? loopId : ''}
                    onChange={(e) => choose(e.target.value)}
                  >
                    <option value="">(choose)</option>
                    {published.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                  {published.length === 0 ? (
                    <HelpText>
                      No loop is published yet. Publish one in the editor, then start it here.
                    </HelpText>
                  ) : !loopId ? (
                    <HelpText>
                      Choose a published loop, then its version, trigger, and input.
                    </HelpText>
                  ) : null}
                </FieldGroup>
                {loopId && !current ? <LoopProblem loopId={loopId} loop={loop} /> : null}
                {current ? (
                  <RunLauncher key={loopId} loopId={loopId} currentVersionId={current} />
                ) : null}
              </div>
            );
          }}
        </QueryState>
      </Card>
    </Page>
  );
}
