// REST-only admission for the owner-process acceptance helper. No sandbox gh writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const control = path.resolve(here, '../../../.tmp/aidlc-control');
const name = 'aidlc-acceptance-support';
async function api(route, method = 'GET', body) {
  const r = await fetch(`http://127.0.0.1:4747${route}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const value = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(`${method} ${route}: ${JSON.stringify(value)}`);
  return value;
}
const matches = (await api('/loops')).items.filter((x) => x.name === name);
if (matches.length > 1) throw new Error('AMBIGUOUS_HELPER');
if (process.argv[2] === 'cleanup') {
  if (matches[0]) await api(`/loops/${matches[0].id}`, 'DELETE');
  fs.writeFileSync(
    path.join(control, 'aidlc-helper-cleanup.json'),
    JSON.stringify(
      { id: matches[0]?.id, name, deleted: Boolean(matches[0]), at: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ deletedHelper: matches[0]?.id }));
} else {
  const closing = JSON.parse(fs.readFileSync(path.join(here, '../closing.loop.json'))).loop;
  const trigger = structuredClone(closing.nodes[0]);
  trigger.config.inputSchema = {
    type: 'object',
    properties: {
      repository: { type: 'string' },
      workspacePath: { type: 'string' },
      action: {
        type: 'string',
        enum: [
          'fixtures',
          'inventory',
          'sandbox-probe',
          'safety-fixtures',
          'hardened-fixtures',
          'hardened-retry-fixture',
        ],
      },
      positiveInput: { type: 'object' },
    },
    required: ['repository', 'workspacePath', 'action'],
    additionalProperties: false,
  };
  const loop = {
    schemaVersion: 1,
    name,
    description:
      'Throwaway owner-process fixture setup and scratch-only readback; no inference or Jev.',
    settings: { ...closing.settings, maxIterations: 4 },
    variables: {},
    nodes: [
      trigger,
      {
        id: 'support',
        label: 'aidlc-support',
        kind: 'script',
        config: {
          command: process.execPath,
          args: [path.join(here, 'acceptance.mjs')],
          cwd: 'workspace',
          stdin: 'thread',
          stdout: 'last-output',
          timeoutSeconds: 180,
        },
      },
      {
        id: 'done',
        label: 'aidlc-done',
        kind: 'exit',
        config: {
          default: 'success',
          return: { mapping: 'lastOutput.value', channels: [{ kind: 'caller' }] },
        },
      },
    ],
    edges: [
      { id: 'e-1', from: { node: 'start', port: 'out' }, to: { node: 'support', port: 'in' } },
      { id: 'e-2', from: { node: 'support', port: 'out' }, to: { node: 'done', port: 'in' } },
    ],
  };
  const saved = matches[0]
    ? await api(`/loops/${matches[0].id}/draft`, 'PUT', { definition: loop })
    : await api('/loops/import', 'POST', {
        format: 'graphgoblin-loop',
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        loop,
      });
  const id = matches[0]?.id ?? saved.loop.id;
  const validation = await api(`/loops/${id}/validate`, 'POST', { definition: loop });
  if (!validation.publishable) throw new Error(JSON.stringify(validation));
  const publication = await api(`/loops/${id}/publish`, 'POST', {});
  const positiveInput = JSON.parse(
    fs.readFileSync(path.join(control, 'aidlc-positive-input.json')),
  );
  for (const action of [
    'fixtures',
    'inventory',
    'sandbox-probe',
    'safety-fixtures',
    'hardened-fixtures',
    'hardened-retry-fixture',
  ])
    fs.writeFileSync(
      path.join(control, `aidlc-support-${action}-input.json`),
      JSON.stringify(
        {
          repository: positiveInput.repository,
          workspacePath: positiveInput.workspacePath,
          action,
          ...(['fixtures', 'safety-fixtures', 'hardened-fixtures'].includes(action)
            ? { positiveInput }
            : {}),
        },
        null,
        2,
      ),
    );
  console.log(JSON.stringify({ id, validation, version: publication.version.version }));
}
