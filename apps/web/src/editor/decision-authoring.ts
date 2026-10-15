/** Pure authoring conversions. Missing semantics stay blank for the author to supply. */
export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function decisionRows(config: unknown): Record<string, unknown>[] {
  const value = record(config);
  const answer = record(value['answer']);
  const rows =
    value['kind'] === 'expression' || value['kind'] === 'llm'
      ? value['routes']
      : answer['type'] === 'noul'
        ? [answer['true'], answer['false']]
        : answer[answer['type'] === 'score' ? 'bands' : 'options'];
  return Array.isArray(rows) ? rows.map(record) : [];
}

export interface DecisionConversion {
  config: Record<string, unknown>;
  lost: string[];
  incomplete: string[];
  keep: string[];
  blocked?: string;
}

export function convertDecision(
  previous: unknown,
  kind: unknown,
  primitive?: unknown,
): DecisionConversion {
  const before = record(previous);
  const answer = record(before['answer']);
  const rows = decisionRows(previous);
  const routes = rows.map(({ id, label }) => ({ id, label }));
  const keep: string[] = [];
  const lost: string[] = [];
  const incomplete: string[] = [];
  let config: Record<string, unknown>;
  if (kind === 'expression') {
    config = { kind, jsonata: '', routes };
    incomplete.push('JSONata source');
  } else if (kind === 'llm') {
    config = {
      kind,
      instructions: '',
      routes,
      harness: 'codex',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
    };
    incomplete.push('Liquid instructions');
  } else {
    const type = primitive ?? 'choice';
    const criteria = rows.map(({ id, label, criteria }) => ({
      id,
      label,
      criteria: typeof criteria === 'string' ? criteria : '',
    }));
    let nextAnswer: Record<string, unknown>;
    if (type === 'noul') {
      if (rows.length !== 2)
        return {
          config: before,
          lost,
          incomplete,
          keep,
          blocked: `Noul needs exactly two routes. This decision has ${rows.length}. Keep Choice or explicitly remove routes first; no routes will be truncated.`,
        };
      nextAnswer = { type, true: criteria[0], false: criteria[1] };
    } else if (type === 'score') {
      nextAnswer = {
        type,
        anchors: ['', ''],
        bands: routes.map((route) => ({ ...route, min: undefined, max: undefined })),
      };
      incomplete.push('Rubric anchors and band boundaries');
    } else {
      nextAnswer = { type: 'choice', options: criteria };
    }
    config =
      before['kind'] === 'classifier'
        ? { ...before, answer: nextAnswer }
        : {
            kind: 'classifier',
            model: '',
            question: '',
            answer: nextAnswer,
            recordAlternatives: true,
          };
    if (before['kind'] !== 'classifier') incomplete.push('Classifier model', 'Liquid question');
    if (type !== 'score' && criteria.some((row) => !row.criteria.trim()))
      incomplete.push('Route criteria');
    if (type !== 'noul') delete config['truthThreshold'];
    if (before['kind'] === 'classifier') {
      keep.push('model', 'question', 'context', 'minConfidence', 'recordAlternatives');
      if (answer['type'] === 'score') lost.push('Rubric anchors and band boundaries');
      if (type === 'score' && rows.some((row) => row['criteria'])) lost.push('Route criteria');
      if (type !== 'noul' && before['truthThreshold'] !== undefined)
        lost.push('Noul true-probability threshold');
    }
  }
  if (before['kind'] !== kind) {
    if (before['kind'] === 'expression') lost.push('JSONata source');
    if (before['kind'] === 'llm') lost.push('Liquid instructions', 'LLM model and effort');
    if (before['kind'] === 'classifier') {
      lost.push(
        'Classifier model',
        'Liquid question',
        'Classifier confidence and recording settings',
      );
      lost.push(
        answer['type'] === 'score' ? 'Rubric anchors and band boundaries' : 'Route criteria',
      );
    }
    if (kind === 'expression' && before['context'] !== undefined)
      lost.push('Provider context selection');
  }
  if (kind !== 'expression' && before['context'] !== undefined) {
    config['context'] = before['context'];
    keep.push('context');
  }
  if (before['kind'] !== 'classifier' && kind !== 'classifier') keep.push('routes');
  return { config, lost, incomplete, keep };
}
