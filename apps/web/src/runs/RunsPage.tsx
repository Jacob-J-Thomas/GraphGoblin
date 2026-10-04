import type { ListRunsQuery } from '@graphgoblin/api-client';
import { RunStatusSchema } from '@graphgoblin/contracts';
import { Link, useSearchParams } from 'react-router';
import { useLoops, useRuns } from '../api/queries.js';
import { Page, PageHeader } from '../components/layout/index.js';
import { Icon } from '../components/icons/index.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import {
  Button,
  buttonStyles,
  Card,
  FieldGroup,
  Label,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/index.js';
import { formatDateTime } from '../lib/utils.js';
import { newRunPath } from './new/paths.js';

const ID_LINK = 'font-mono text-sm font-medium text-link underline-offset-[3px] hover:underline';
const LINK = 'text-link underline-offset-[3px] hover:underline';

/**
 * Runs across loops, filtered by loop, status, and parent run (filters live in the URL), and the
 * New run action: the only place the app starts runs.
 */
export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const loopId = params.get('loop') ?? '';
  const status = params.get('status') ?? '';
  const parent = params.get('parent') ?? '';
  const query: ListRunsQuery = {
    ...(loopId ? { loopId } : {}),
    ...(status ? { status } : {}),
    ...(parent ? { parent } : {}),
  };
  const loopsQuery = useLoops();
  const runsQuery = useRuns(query, 5000);
  const names = new Map((loopsQuery.data ?? []).map((l) => [l.id, l.name]));

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <Page>
      <PageHeader
        title="Runs"
        actions={
          // With the list filtered to one loop, the new run starts with that loop chosen.
          <Link to={newRunPath(loopId)} className={buttonStyles()}>
            <Icon name="plus" />
            New run
          </Link>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <FieldGroup className="w-[220px] max-sm:w-full">
            <Label htmlFor="filter-loop">Loop</Label>
            <Select
              id="filter-loop"
              value={loopId}
              onChange={(e) => setFilter('loop', e.target.value)}
            >
              <option value="">All loops</option>
              {(loopsQuery.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup className="w-[220px] max-sm:w-full">
            <Label htmlFor="filter-status">Status</Label>
            <Select
              id="filter-status"
              value={status}
              onChange={(e) => setFilter('status', e.target.value)}
            >
              <option value="">Any status</option>
              {RunStatusSchema.options.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </FieldGroup>
          <FieldGroup className="w-[220px] max-sm:w-full">
            <Label htmlFor="filter-parent">Parent</Label>
            <Select
              id="filter-parent"
              value={parent}
              onChange={(e) => setFilter('parent', e.target.value)}
            >
              <option value="">Any</option>
              <option value="none">Top-level runs only</option>
              {parent && parent !== 'none' ? (
                <option value={parent}>Children of {parent.slice(-6)}</option>
              ) : null}
            </Select>
          </FieldGroup>
          {loopId || status || parent ? (
            <Button variant="ghost" onClick={() => setParams(new URLSearchParams())}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </Card>
      <QueryState query={runsQuery} what="Runs">
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">No runs match.</p>
          ) : (
            <Card flush>
              <Table>
                <thead>
                  <tr>
                    <Th>Run</Th>
                    <Th>Loop</Th>
                    <Th>Status</Th>
                    <Th>Started</Th>
                    <Th>Parent</Th>
                    <Th>Children</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((run) => (
                    <tr key={run.id}>
                      <Td>
                        <Link className={ID_LINK} to={`/runs/${run.id}`}>
                          {run.id}
                        </Link>
                      </Td>
                      <Td>{names.get(run.loopId) ?? run.loopId}</Td>
                      <Td>
                        <RunStatusBadge status={run.status} />
                      </Td>
                      <Td className="text-sm whitespace-nowrap text-muted">
                        {formatDateTime(run.startedAt ?? run.createdAt)}
                      </Td>
                      <Td>
                        {run.parentRunId ? (
                          <Link className={ID_LINK} to={`/runs/${run.parentRunId}`}>
                            {run.parentRunId.slice(-6)}
                          </Link>
                        ) : (
                          <span className="text-subtle">-</span>
                        )}
                      </Td>
                      <Td>
                        <Link className={LINK} to={`/runs?parent=${run.id}`}>
                          children
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )
        }
      </QueryState>
    </Page>
  );
}
