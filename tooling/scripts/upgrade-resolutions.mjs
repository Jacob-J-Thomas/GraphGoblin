import { validateUpgradeCurrentResolutions } from '../../packages/domain/dist/index.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const put = (map, key, value) =>
  Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });

/** Review items own their proposal-eligibility metadata; null can be a generated removal. */
export function pendingItems(definitions) {
  return definitions.flatMap((definition) => {
    const context = {
      versionId: definition.id,
      loopId: definition.loopId,
      loopName: definition.loopName ?? definition.loopId,
    };
    const items = definition.reviewItems
      .filter((item) => item.status === 'pending')
      .map((item) => ({
        ...item,
        ...context,
        resolutionLocations: [{ stage: 'v3', key: item.id }],
      }));
    // Frozen v1/v2 stages can require authored input before any v3 proposal exists.
    const earlier = definition.issues.filter(
      (issue) => issue.kind === 'pending' && !items.some((item) => item.id === issue.id),
    );
    return [
      ...items,
      ...earlier.map((issue) => ({
        ...context,
        id: issue.id ?? issue.path,
        kind: issue.code,
        path: issue.path,
        hash: issue.hash,
        reason: issue.message,
        hasGeneratedProposal: false,
        resolutionLocations: issue.resolutionLocations ?? [],
      })),
    ];
  });
}
export function pendingSummary(definitions) {
  const byKind = new Map();
  for (const item of pendingItems(definitions))
    byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  return Object.fromEntries([...byKind].sort(([a], [b]) => a.localeCompare(b)));
}

/** Preserve all supplied stage maps and authored choices. Apply still rechecks source hashes. */
export function generatedResolutions(report, merged) {
  if (
    !object(report) ||
    report.format !== 'graphgoblin-upgrade-inspection' ||
    report.targetVersion !== 4 ||
    !Array.isArray(report.definitions)
  )
    throw new Error('Expected a current store inspect report; run inspect with this build first');
  const ids = new Set();
  for (const definition of report.definitions) {
    if (
      !object(definition) ||
      typeof definition.id !== 'string' ||
      !definition.id ||
      typeof definition.loopId !== 'string' ||
      !Array.isArray(definition.reviewItems) ||
      !Array.isArray(definition.issues) ||
      ids.has(definition.id)
    )
      throw new Error('Malformed or duplicate definition in inspect report');
    ids.add(definition.id);
    for (const item of definition.reviewItems)
      if (
        !object(item) ||
        typeof item.id !== 'string' ||
        typeof item.kind !== 'string' ||
        !['pending', 'automatic', 'resolved'].includes(item.status) ||
        typeof item.hasGeneratedProposal !== 'boolean' ||
        !/^[a-f0-9]{64}$/.test(item.hash) ||
        (item.hasGeneratedProposal && !Object.hasOwn(item, 'proposedValue'))
      )
        throw new Error(
          'Malformed review item or missing proposal metadata; run inspect with this build first',
        );
  }
  if (
    merged === undefined &&
    report.definitions.some((definition) =>
      definition.reviewItems.some((item) => item.status === 'resolved'),
    )
  )
    throw new Error(
      'Inspect report contains resolved owner choices; supply --merge with the resolutions used for inspect to preserve them',
    );
  if (merged === undefined) merged = {};
  if (
    !object(merged) ||
    Object.values(merged).some((value) => validateUpgradeCurrentResolutions(value).length)
  )
    throw new Error('Merge input must contain per-version namespaced resolutions');
  const resolutions = structuredClone(merged);
  const byKind = new Map(),
    byLoop = new Map(),
    unresolved = [];
  let approved = 0,
    kept = 0;
  for (const item of pendingItems(report.definitions)) {
    const existing = Object.hasOwn(resolutions, item.versionId)
      ? resolutions[item.versionId]
      : undefined;
    let action;
    if (
      item.resolutionLocations.some(({ stage, map, key }) => {
        const entries = map ? existing?.[stage]?.[map] : existing?.[stage];
        return object(entries) && Object.hasOwn(entries, key);
      })
    ) {
      action = 'kept';
      kept += 1;
    } else if (item.hasGeneratedProposal) {
      action = 'approved';
      approved += 1;
      const selected = existing ?? {};
      selected.v3 ??= {};
      put(selected.v3, item.id, {
        hash: item.hash,
        action: 'approve',
        reason:
          'Owner explicitly bulk-approved this exact generated proposal via --approve-generated; running-product validation follows.',
      });
      put(resolutions, item.versionId, selected);
    } else {
      action = 'unresolved';
      const { versionId, loopId, loopName, id, kind, path, hash, reason } = item;
      unresolved.push({ versionId, loopId, loopName, id, kind, path, hash, reason });
    }
    const kind = byKind.get(item.kind) ?? { pending: 0, approved: 0, kept: 0, unresolved: 0 };
    kind.pending += 1;
    kind[action] += 1;
    byKind.set(item.kind, kind);
    const loop = byLoop.get(item.loopId) ?? {
      loopId: item.loopId,
      loopName: item.loopName,
      approved: 0,
      kept: 0,
      unresolved: 0,
      byKind: new Map(),
    };
    loop[action] += 1;
    const loopKind = loop.byKind.get(item.kind) ?? {
      pending: 0,
      approved: 0,
      kept: 0,
      unresolved: 0,
    };
    loopKind.pending += 1;
    loopKind[action] += 1;
    loop.byKind.set(item.kind, loopKind);
    byLoop.set(item.loopId, loop);
  }
  return {
    resolutions,
    summary: {
      approved,
      kept,
      unresolved,
      byKind: Object.fromEntries([...byKind].sort(([a], [b]) => a.localeCompare(b))),
      byLoop: [...byLoop.values()]
        .sort((a, b) => a.loopId.localeCompare(b.loopId))
        .map((loop) => ({
          ...loop,
          byKind: Object.fromEntries([...loop.byKind].sort(([a], [b]) => a.localeCompare(b))),
        })),
      tradeOff:
        'Generated proposals are mechanically equivalent where proved; otherwise they are a reviewed best effort. The owner accepts those proposals and checks behavior in the running product afterwards.',
    },
  };
}
