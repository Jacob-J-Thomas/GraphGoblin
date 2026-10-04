import type { LoopDefinition } from '@graphgoblin/contracts';
import { useState } from 'react';
import { useLoop, useLoops } from '../api/queries.js';
import { QueryState } from '../components/status.js';
import { Input, Label, Select } from '../components/ui/index.js';
import { prettyJson } from '../lib/utils.js';

/** What a published loop takes and returns, for choosing it as a subloop. */
function LoopSignature({ loopId }: { loopId: string }) {
  const query = useLoop(loopId);
  return (
    <QueryState query={query} what="Loop">
      {(detail) => {
        const def: LoopDefinition | undefined = detail.current?.definition;
        if (!def)
          return <p className="text-xs text-orange-800">This loop has no published version.</p>;
        const triggers = def.nodes.filter((n) => n.kind === 'trigger');
        const exits = def.nodes.filter((n) => n.kind === 'exit');
        return (
          <div className="text-xs" aria-label="Subloop signature">
            <p className="font-semibold">Trigger input</p>
            {triggers.map((t) => (
              <pre key={t.id} className="whitespace-pre-wrap rounded bg-slate-50 p-1">
                {t.id} ({t.config.subtype}):{' '}
                {t.config.subtype === 'manual' && t.config.inputSchema
                  ? prettyJson(t.config.inputSchema)
                  : 'any'}
              </pre>
            ))}
            <p className="mt-1 font-semibold">Returns</p>
            {exits.map((e) => (
              <pre key={e.id} className="whitespace-pre-wrap rounded bg-slate-50 p-1">
                {e.id}: {e.config.return.mapping}
              </pre>
            ))}
          </div>
        );
      }}
    </QueryState>
  );
}

/** Search published loops and set the subloop node's `loopRef.loopId`. */
export function SubloopPicker({
  currentLoopId,
  value,
  onPick,
}: {
  currentLoopId: string;
  value: string;
  onPick: (loopId: string) => void;
}) {
  const query = useLoops();
  const [search, setSearch] = useState('');
  return (
    <div className="mb-3 rounded border border-indigo-200 bg-indigo-50 p-2">
      <QueryState query={query} what="Loops">
        {(items) => {
          const published = items.filter(
            (l) =>
              l.currentVersionId &&
              l.id !== currentLoopId &&
              l.name.toLowerCase().includes(search.toLowerCase()),
          );
          return (
            <>
              <Label htmlFor="subloop-search">Find a published loop</Label>
              <Input
                id="subloop-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Label htmlFor="subloop-pick" className="mt-1">
                Subloop
              </Label>
              <Select id="subloop-pick" value={value} onChange={(e) => onPick(e.target.value)}>
                <option value="">(choose)</option>
                {published.map((loop) => (
                  <option key={loop.id} value={loop.id}>
                    {loop.name}
                  </option>
                ))}
              </Select>
            </>
          );
        }}
      </QueryState>
      {value ? <LoopSignature loopId={value} /> : null}
    </div>
  );
}
