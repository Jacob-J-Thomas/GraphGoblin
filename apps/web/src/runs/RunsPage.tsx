import type { ListRunsQuery } from '@graphgoblin/api-client';
import { RunStatusSchema } from '@graphgoblin/contracts';
import { Link, useSearchParams } from 'react-router';
import { useLoops, useRuns } from '../api/queries.js';
import { QueryState, RunStatusBadge } from '../components/status.js';
import { Button, Card, Label, Select, Table, Td, Th } from '../components/ui/index.js';
import { formatDateTime } from '../lib/utils.js';

/** Runs across loops, filtered by loop, status, and parent run. Filters live in the URL. */
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
    <div className="space-y-3 p-4">
      <h1 className="text-lg font-semibold">Runs</h1>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
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
          </div>
          <div>
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
          </div>
          <div>
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
          </div>
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
            <p className="text-sm text-slate-500">No runs match.</p>
          ) : (
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
                      <Link
                        className="font-mono text-sky-800 hover:underline"
                        to={`/runs/${run.id}`}
                      >
                        {run.id}
                      </Link>
                    </Td>
                    <Td>{names.get(run.loopId) ?? run.loopId}</Td>
                    <Td>
                      <RunStatusBadge status={run.status} />
                    </Td>
                    <Td>{formatDateTime(run.startedAt ?? run.createdAt)}</Td>
                    <Td>
                      {run.parentRunId ? (
                        <Link
                          className="font-mono text-xs text-sky-800 hover:underline"
                          to={`/runs/${run.parentRunId}`}
                        >
                          {run.parentRunId.slice(-6)}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </Td>
                    <Td>
                      <Link
                        className="text-xs text-sky-800 hover:underline"
                        to={`/runs?parent=${run.id}`}
                      >
                        children
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        }
      </QueryState>
    </div>
  );
}
