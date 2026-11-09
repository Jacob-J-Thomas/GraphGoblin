import { LoopDefinitionSchema, type LoopDefinition } from '@graphgoblin/contracts';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { useLoop } from '../api/queries.js';

const dynamic = (value: string | undefined) => value !== undefined && /{{|{%|\$\{/.test(value);
/** This describes the current published selection, never the model used by an earlier turn. */
function modelObservation(definition: LoopDefinition): string {
  const inferences = definition.nodes.filter((node) => node.kind === 'inference');
  if (definition.nodes.some((node) => node.kind === 'subloop'))
    return 'Models: published workflow includes subloops';
  if (
    definition.nodes.some((node) => node.kind === 'decision' && node.config.kind !== 'expression')
  )
    return 'Models: published workflow includes model-based decisions';
  if (inferences.length !== 1)
    return `Models: ${inferences.length} inference steps in the published workflow`;
  const inference = inferences[0]!;
  const harness = inference.config.harness;
  const inherited = definition.settings.defaults.byHarness[harness]?.model;
  const model = inference.config.model ?? inherited;
  if (dynamic(model)) return 'Models: selected dynamically by the published workflow';
  if (inference.config.model)
    return `Model: ${harness} / ${inference.config.model} (explicit in published loop)`;
  if (inherited) return `Model: ${harness} / ${inherited} (inherited from published loop default)`;
  return `Model: ${harness} (inherits current Settings or process defaults)`;
}

/** Owner composition only: peripheral Chat never imports this component or fetches loop data. */
export function OwnerChatSummary({ loopId }: { loopId: string }) {
  const query = useLoop(loopId);
  const refetch = query.refetch;
  useEffect(() => {
    const refresh = () => {
      void refetch();
    };
    window.addEventListener('graphgoblin:chat-readiness-changed', refresh);
    return () => window.removeEventListener('graphgoblin:chat-readiness-changed', refresh);
  }, [refetch]);
  const current = query.data?.current;
  const definition =
    current?.status === 'published' && current.id === query.data?.loop.currentVersionId
      ? LoopDefinitionSchema.safeParse(current.definition)
      : undefined;
  const observation = query.isError
    ? 'Published model configuration unavailable'
    : definition?.success
      ? modelObservation(definition.data)
      : query.isPending
        ? 'Published model: checking…'
        : 'No published model configuration';
  return (
    <>
      <span aria-label="Current published model configuration">{observation}</span>
      {' · '}
      <Link to={`/loops/${encodeURIComponent(loopId)}/edit`}>Open loop</Link>
      {' · '}
      <Link to="/settings#model-defaults">Model settings</Link>
    </>
  );
}
