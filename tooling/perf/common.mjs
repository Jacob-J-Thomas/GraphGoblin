/* global Buffer, fetch, AbortSignal, setTimeout, URL */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export async function dependency(name, app = 'api') {
  return import(
    import.meta.resolve(name, new URL('../../apps/' + app + '/package.json', import.meta.url))
  );
}
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
export function assertSampleCount(count, total) {
  if (!Number.isInteger(count) || count <= 0 || count > total)
    throw new Error(`Invalid CPU profile window: ${count} of ${total} samples`);
}
// Fixed-size logarithmic histogram; percentile upper bounds are within 10% above 1 us.
export class Timings {
  count = 0;
  totalMs = 0;
  maxMs = 0;
  bins = new Map();
  add(ms) {
    this.count++;
    this.totalMs += ms;
    this.maxMs = Math.max(this.maxMs, ms);
    const bin = Math.ceil(Math.log(Math.max(0.001, ms) / 0.001) / Math.log(1.1));
    this.bins.set(bin, (this.bins.get(bin) ?? 0) + 1);
  }
  json() {
    const percentile = (p) => {
      let seen = 0;
      for (const [bin, count] of [...this.bins].sort((a, b) => a[0] - b[0])) {
        seen += count;
        if (seen >= this.count * p) return 0.001 * 1.1 ** bin;
      }
      return null;
    };
    return {
      count: this.count,
      totalMs: this.totalMs,
      meanMs: this.count ? this.totalMs / this.count : null,
      p50UpperMs: percentile(0.5),
      p95UpperMs: percentile(0.95),
      maxMs: this.maxMs,
    };
  }
}
export async function disk(directory) {
  let size = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = await disk(path);
      size += child.bytes;
      files += child.files;
    } else {
      size += (await stat(path)).size;
      files++;
    }
  }
  return { bytes: size, files };
}
export function definition(
  format,
  { passes, contextBytes = 0, inference = true, artifacts = false, grow = false },
) {
  const growing = !inference || grow;
  const mutation = {
    operations: [
      {
        op: 'set',
        path: '/vars/history/-',
        value: { kind: 'literal', value: 'x'.repeat(contextBytes) },
      },
    ],
  };
  const work = inference
    ? {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          prompt: { template: 'controlled measurement' },
          output: { toMessages: 'none', captureTranscript: artifacts ? 'artifact' : 'none' },
        },
      }
    : { id: 'work', kind: 'mutate', label: 'Grow context', config: mutation };
  const edge = (id, from, port, to) => ({ id, from: { node: from, port }, to: { node: to } });
  return {
    schemaVersion: format,
    name: `measurement-${passes}-${contextBytes}-${artifacts}`,
    settings: { maxNodeVisits: 10_000 },
    ...(growing ? { variables: { history: { type: 'array' } } } : {}),
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      ...(growing
        ? [
            {
              id: 'init',
              kind: 'mutate',
              label: 'Initialize',
              config: {
                operations: [
                  { op: 'set', path: '/vars/history', value: { kind: 'literal', value: [] } },
                ],
              },
            },
          ]
        : []),
      work,
      ...(grow ? [{ id: 'grow', kind: 'mutate', label: 'Grow context', config: mutation }] : []),
      {
        id: 'gate',
        kind: 'decision',
        label: 'Repeat',
        config: {
          kind: 'expression',
          jsonata: '"again"',
          maxPasses: passes,
          routes: [
            { id: 'again', label: 'Again', repeat: true },
            { id: 'stop', label: 'Stop' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { outcome: 'success' } },
    ],
    edges: [
      edge('a', 'start', 'out', growing ? 'init' : 'work'),
      ...(growing ? [edge('init-work', 'init', 'out', 'work')] : []),
      edge('b', 'work', 'out', grow ? 'grow' : 'gate'),
      ...(grow ? [edge('grow-gate', 'grow', 'out', 'gate')] : []),
      edge('c', 'gate', 'again', 'work'),
      edge('d', 'gate', 'stop', 'done'),
      edge('e', 'gate', 'limit-reached', 'done'),
    ],
  };
}
export async function json(base, path, body) {
  const response = await fetch(base + path, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}
export class Frames {
  digest() {
    return this.hasher.copy().digest('hex');
  }
  buffer = '';
  count = 0;
  gaps = 0;
  constructor(after = 0, hasher = createHash('sha256')) {
    this.hasher = hasher;
    this.last = after;
  }
  push(text) {
    this.buffer += text;
    let index;
    while ((index = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const id = /^id: (\d+)$/m.exec(frame);
      if (!id) continue;
      const seq = Number(id[1]);
      const data = /^data: (.+)$/m.exec(frame);
      if (!data || JSON.parse(data[1]).seq !== seq) throw new Error('SSE id/payload mismatch');
      this.hasher.update(data[1] + '\n');
      if (seq !== this.last + 1) this.gaps++;
      this.last = seq;
      this.count++;
    }
  }
}
