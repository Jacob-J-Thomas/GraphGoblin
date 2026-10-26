import { HistoryState } from '../components/HistoryState.js';
import { useEffect, useState } from 'react';
import { HistoryEligibility } from './HistoryEligibility.js';
import { GraphGoblinApiError, runs, type ListRunsQuery } from '@graphgoblin/api-client';
import { useApi } from '../api/context.js';
import { RunStatusSchema } from '@graphgoblin/contracts';
import { Link, useSearchParams } from 'react-router';
import { useLoops, useRuns } from '../api/queries.js';
import { Page, PageHeader } from '../components/layout/index.js';
import { Icon } from '../components/icons/index.js';
import { RunStatusBadge } from '../components/status.js';
import {
  Button,
  buttonStyles,
  Card,
  Checkbox,
  FieldGroup,
  FieldRow,
  Label,
  Select,
  Table,
  Td,
  Th,
} from '../components/ui/index.js';
import { formatDateTime } from '../lib/utils.js';
import { newRunPath } from './new/paths.js';

const ID_LINK =
  'touch-target font-mono text-sm font-medium text-link underline-offset-[3px] hover:underline';
const LINK = 'touch-target text-link underline-offset-[3px] hover:underline';

/**
 * Runs across loops, filtered by loop, status, and parent run (filters live in the URL), and the
 * New run action: the only place the app starts runs.
 */
export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
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
  const client = useApi();
  useEffect(() => {
    if (!runsQuery.data) return;
    const visible = new Set(
      runsQuery.data.pages.flatMap((page) => page.items.map((run) => run.id)),
    );
    const absent = selected.filter((id) => !visible.has(id));
    if (!absent.length) return;
    let cancelled = false;
    void Promise.all(
      absent.map(async (id) => {
        try {
          await runs.get(client, id);
        } catch (error) {
          if (error instanceof GraphGoblinApiError && error.status === 404) return id;
        }
        return undefined; // Existing, protected and unknown records remain in the explicit selection.
      }),
    ).then((missing) => {
      if (cancelled) return;
      const removed = new Set(missing.filter((id) => id !== undefined));
      if (removed.size)
        setSelected((ids) =>
          ids.some((id) => removed.has(id)) ? ids.filter((id) => !removed.has(id)) : ids,
        );
    });
    return () => {
      cancelled = true;
    };
  }, [client, runsQuery.data, selected]);

  const setFilter = (key: string, value: string) => {
    setSelected([]);
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
        <FieldRow>
          <FieldGroup className="w-[220px]">
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
          <FieldGroup className="w-[220px]">
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
          <FieldGroup className="w-[220px]">
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
            <Button
              variant="ghost"
              onClick={() => {
                setSelected([]);
                setParams(new URLSearchParams());
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </FieldRow>
      </Card>
      <HistoryEligibility
        runIds={selected}
        onConfirmed={(confirmedIds) =>
          setSelected((ids) => ids.filter((id) => !confirmedIds.includes(id)))
        }
      />
      <HistoryState query={runsQuery} what="Runs">
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted">No runs match.</p>
          ) : (
            <Card flush>
              <Table stack="lg">
                <thead>
                  <tr>
                    <Th>Select history</Th>
                    <Th>Run</Th>
                    <Th>Loop</Th>
                    <Th>Status</Th>
                    <Th>Retention</Th>
                    <Th>Started</Th>
                    <Th>Parent</Th>
                    <Th>Children</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((run) => (
                    <tr key={run.id}>
                      <Td label="Select history">
                        <Checkbox
                          aria-label={`Select history ${run.id}`}
                          checked={selected.includes(run.id)}
                          onChange={(event) =>
                            setSelected((ids) =>
                              event.target.checked
                                ? [...ids, run.id]
                                : ids.filter((id) => id !== run.id),
                            )
                          }
                        />
                      </Td>
                      <Td>
                        <Link className={ID_LINK} to={`/runs/${run.id}`}>
                          {run.id}
                        </Link>
                      </Td>
                      <Td label="Loop" className="wrap-anywhere">
                        {run.pinned.name}
                      </Td>
                      <Td label="Status">
                        <RunStatusBadge status={run.status} />
                        {run.status === 'failed' && run.failure ? (
                          <p className="mt-1 text-xs wrap-anywhere text-muted">
                            {run.failure.code}: {run.failure.message}
                          </p>
                        ) : null}
                      </Td>
                      <Td label="Retention">
                        {run.deletionApproval ? 'Delete-ready' : 'Retained'}
                      </Td>
                      <Td label="Started" className="text-sm whitespace-nowrap text-muted">
                        {formatDateTime(run.startedAt ?? run.createdAt)}
                      </Td>
                      <Td label="Parent">
                        {run.parentRunId ? (
                          <Link className={ID_LINK} to={`/runs/${run.parentRunId}`}>
                            {run.parentRunId.slice(-6)}
                          </Link>
                        ) : (
                          <span className="text-subtle">-</span>
                        )}
                      </Td>
                      <Td label="Children">
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
      </HistoryState>
    </Page>
  );
}
