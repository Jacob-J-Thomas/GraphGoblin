import type { LoopDefinition } from '@graphgoblin/contracts';
import { useState } from 'react';
import { useLoop, useLoops } from '../api/queries.js';
import { QueryState } from '../components/status.js';
import { FieldGroup, HelpText, Input, Label, Select } from '../components/ui/index.js';
import { prettyJson } from '../lib/utils.js';

/** What a published loop takes and returns, for choosing it as a subloop. */
function LoopSignature({ loopId }: { loopId: string }) {
  const query = useLoop(loopId);
  return (
    <QueryState query={query} what="Loop">
      {(detail) => {
        const def: LoopDefinition | undefined = detail.current?.definition;
        if (!def) return <HelpText tone="bad">This loop has no published version.</HelpText>;
        const triggers = def.nodes.filter((n) => n.kind === 'trigger');
        const exits = def.nodes.filter((n) => n.kind === 'exit');
        return (
          <div className="grid gap-1 text-xs" aria-label="Subloop signature">
            <p className="font-semibold">Trigger input</p>
            {triggers.map((t) => (
              <pre
                key={t.id}
                className="rounded-md border border-default bg-code-bg px-2 py-1 whitespace-pre-wrap text-code-fg"
              >
                {t.id} ({t.config.subtype}):{' '}
                {t.config.subtype === 'manual' && t.config.inputSchema
                  ? prettyJson(t.config.inputSchema)
                  : 'any'}
              </pre>
            ))}
            <p className="mt-1 font-semibold">Returns</p>
            {exits.map((e) => (
              <pre
                key={e.id}
                className="rounded-md border border-default bg-code-bg px-2 py-1 whitespace-pre-wrap text-code-fg"
              >
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
    <div className="grid gap-3 rounded-md border border-default bg-surface-sunken p-3">
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
              <FieldGroup>
                <Label htmlFor="subloop-search">Find a published loop</Label>
                <Input
                  id="subloop-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </FieldGroup>
              <FieldGroup>
                <Label htmlFor="subloop-pick">Subloop</Label>
                <Select id="subloop-pick" value={value} onChange={(e) => onPick(e.target.value)}>
                  <option value="">(choose)</option>
                  {published.map((loop) => (
                    <option key={loop.id} value={loop.id}>
                      {loop.name}
                    </option>
                  ))}
                </Select>
              </FieldGroup>
            </>
          );
        }}
      </QueryState>
      {value ? <LoopSignature loopId={value} /> : null}
    </div>
  );
}
