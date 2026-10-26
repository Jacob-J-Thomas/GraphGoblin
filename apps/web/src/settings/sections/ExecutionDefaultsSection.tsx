import { ExecutionLimitsSchema } from '@graphgoblin/contracts';
import { Card, HelpText } from '../../components/ui/index.js';

export function ExecutionDefaultsSection() {
  const defaults = ExecutionLimitsSchema.parse({});
  return (
    <Card title="Execution defaults">
      <p>
        Maximum node visits: {defaults.maxNodeVisits}.{' '}
        {defaults.runDeadlineSeconds === null
          ? 'No run deadline unless the loop sets one.'
          : `Run deadline: ${defaults.runDeadlineSeconds} seconds.`}
      </p>
      <p>
        {defaults.structuredTimeoutMs === null
          ? 'No structured completion deadline unless the loop sets one.'
          : `Structured completion deadline: ${defaults.structuredTimeoutMs} milliseconds.`}
      </p>
      <HelpText>
        These defaults apply when a loop omits its limits. Change each limit in the editor's Loop
        tab; Unlimited visits and passes must be chosen explicitly. Intentional repetitions use
        decision gates with authored maximum passes. GraphGoblin imposes no spending, token,
        subscription or provider-turn budget.
      </HelpText>
    </Card>
  );
}
