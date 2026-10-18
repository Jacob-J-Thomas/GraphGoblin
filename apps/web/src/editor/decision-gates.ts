/** Raw editor values can be incomplete; gate controls must remain usable before schema parsing. */
export function gateRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function gateRows(config: unknown): { path: string; value: Record<string, unknown> }[] {
  const raw = gateRecord(config),
    answer = gateRecord(raw['answer']);
  if (raw['kind'] === 'expression' || raw['kind'] === 'llm')
    return (Array.isArray(raw['routes']) ? raw['routes'] : []).map((row, i) => ({
      path: `routes.${i}`,
      value: gateRecord(row),
    }));
  if (answer['type'] === 'noul')
    return ['true', 'false'].map((side) => ({
      path: `answer.${side}`,
      value: gateRecord(answer[side]),
    }));
  const key = answer['type'] === 'score' ? 'bands' : 'options';
  return (Array.isArray(answer[key]) ? answer[key] : []).map((row, i) => ({
    path: `answer.${key}.${i}`,
    value: gateRecord(row),
  }));
}

export const hasRepeatRoute = (config: unknown): boolean =>
  gateRows(config).some((row) => row.value['repeat'] === true);

export const isRepeatPort = (config: unknown, port: string): boolean =>
  gateRows(config).some((row) => row.value['repeat'] === true && row.value['id'] === port);

export function cleanGateLimits(config: unknown): unknown {
  if (hasRepeatRoute(config)) return config;
  const { maxPasses: _passes, maxRunTimeSeconds: _seconds, ...rest } = gateRecord(config);
  return rest;
}
