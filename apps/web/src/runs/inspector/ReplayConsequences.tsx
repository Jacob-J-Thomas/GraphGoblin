import type { RunRecovery } from '@graphgoblin/contracts';

const names = {
  script: 'script',
  inference: 'provider turn',
  subloop: 'child run',
  delivery: 'delivery',
};

export function ReplayConsequences({
  effects,
}: {
  effects: RunRecovery['replay'][number]['effects'];
}) {
  return (
    <>
      <p>
        Replay runs again from the chosen node as a separate run with a new ID. Scripts, provider
        turns, child runs and deliveries after that node run again for the new run. It does not undo
        the source's recorded effects or results, or resend the source's own recorded deliveries.
      </p>
      {effects.length ? (
        <>
          <p>Work that can run again on this path, if reached:</p>
          <ul aria-label="Work that can run again">
            {effects.map((effect) => (
              <li key={effect.nodeId}>
                {effect.label} ({effect.nodeId}): {names[effect.kind]}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          The recorded definition identifies no scripts, provider turns, child runs or deliveries on
          this path.
        </p>
      )}
    </>
  );
}
