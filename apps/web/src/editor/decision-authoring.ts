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
  moves: { from: string; to: string }[];
  blocked?: string;
}

/** Friendly names for loss previews, including unfinished route fields. */
export function decisionFieldLabel(config: unknown, path: string): string {
  const route =
    /^(?:routes\.(\d+)|answer\.(?:options|bands)\.(\d+)|answer\.(true|false))(?:\.(.*))?$/.exec(
      path,
    );
  if (route) {
    const index = route[3] ? (route[3] === 'true' ? 0 : 1) : Number(route[1] ?? route[2]);
    const label = decisionRows(config)[index]?.['label'];
    const name = `Route ${index + 1}${typeof label === 'string' && label.trim() ? ` “${label}”` : ''}`;
    return `${name}${route[4] ? ` ${fieldLabel(route[4])}` : ''}`;
  }
  return fieldLabel(path);
}

function fieldLabel(path: string): string {
  const labels: Record<string, string> = {
    id: 'ID',
    label: 'name',
    criteria: 'criteria',
    min: 'minimum',
    max: 'maximum',
    jsonata: 'JSONata source',
    instructions: 'Instructions',
    question: 'Question',
    model: 'Model',
    effort: 'Effort',
    harness: 'Harness',
    routes: 'Routes',
    answer: 'Answer',
    'answer.options': 'Routes',
    'answer.bands': 'Score bands',
    'answer.anchors': 'Rubric anchors',
    context: 'Provider context selection',
    'context.messages': 'Selected messages',
    'context.vars': 'Selected variables',
    'context.includeLastOutput': 'Include last output',
    minConfidence: 'Minimum confidence',
    truthThreshold: 'Noul true-probability threshold',
    recordAlternatives: 'Record alternatives',
    'model.value': 'Model',
    'model.mode': 'Model selection',
    'effort.value': 'Effort',
    'effort.mode': 'Effort selection',
  };
  if (labels[path]) return labels[path];
  const item = /^(.*)\.(\d+)$/.exec(path);
  if (item) return `${fieldLabel(item[1]!)} ${Number(item[2]) + 1}`;
  return path
    .split('.')
    .map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .join(' ');
}

function rowPaths(config: unknown): string[] {
  const value = record(config);
  const answer = record(value['answer']);
  return decisionRows(config).map((_, index) =>
    value['kind'] !== 'classifier'
      ? `routes.${index}`
      : answer['type'] === 'noul'
        ? `answer.${index === 0 ? 'true' : 'false'}`
        : `answer.${answer['type'] === 'score' ? 'bands' : 'options'}.${index}`,
  );
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
  const moves: DecisionConversion['moves'] = [];
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
          moves,
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
      if (type === 'noul') keep.push('truthThreshold');
      if (type !== 'noul' && before['truthThreshold'] !== undefined)
        lost.push('Noul true-probability threshold');
    }
  }
  if (before['kind'] !== kind) {
    if (before['kind'] === 'expression') lost.push('JSONata source');
    if (before['kind'] === 'llm') {
      lost.push('Liquid instructions');
      if (
        record(before['model'])['mode'] === 'explicit' ||
        record(before['effort'])['mode'] === 'explicit'
      )
        lost.push('LLM model and effort');
    }
    if (before['kind'] === 'classifier') {
      lost.push('Classifier model', 'Liquid question');
      if (
        before['minConfidence'] !== undefined ||
        before['recordAlternatives'] === false ||
        before['truthThreshold'] !== undefined
      )
        lost.push('Classifier confidence and recording settings');
      lost.push(
        answer['type'] === 'score' ? 'Rubric anchors and band boundaries' : 'Route criteria',
      );
    }
    const context = record(before['context']);
    if (
      kind === 'expression' &&
      ((context['messages'] !== undefined && context['messages'] !== 'last') ||
        context['vars'] !== undefined ||
        context['includeLastOutput'] === false)
    )
      lost.push('Provider context selection');
  }
  if (kind !== 'expression' && before['context'] !== undefined) {
    config['context'] = before['context'];
    keep.push('context');
  }
  const nextPaths = rowPaths(config);
  const retainCriteria =
    before['kind'] === 'classifier' &&
    kind === 'classifier' &&
    answer['type'] !== 'score' &&
    record(config['answer'])['type'] !== 'score';
  rowPaths(before).forEach((from, index) => {
    for (const field of ['id', 'label', ...(retainCriteria ? ['criteria'] : [])]) {
      const source = `${from}.${field}`;
      const target = `${nextPaths[index]}.${field}`;
      if (source === target) keep.push(source);
      else moves.push({ from: source, to: target });
    }
  });
  // Whole Routes JSON is compatible only between the two route-based kinds.
  if (before['kind'] !== 'classifier' && kind !== 'classifier') keep.push('routes');
  return { config, lost, incomplete, keep, moves };
}
