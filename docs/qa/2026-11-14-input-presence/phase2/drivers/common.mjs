// Shared helpers for the #235 phase 2 drivers. Plain Node ESM; no repository files are written.
//
//   node drivers/<script>.mjs   (Node 22.23.4 on PATH)
//
// The backend is the repository's own e2e server (apps/web/e2e/server.ts): the real API over an
// in-memory database with the fake harness, on an ephemeral loopback port, serving apps/web/dist.
// It is started here exactly as e2e/global-setup.ts starts it and stopped through its stdin.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO =
  process.env.GG_REPO ?? 'C:/Users/98jak/.codex/worktrees/gg-20261114-i08-input/GraphGoblin';
export const OUT =
  process.env.GG_QA_OUT ?? 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-235-claude-phase2';

const requireFromWeb = createRequire(`${REPO}/apps/web/package.json`);
export const { chromium } = requireFromWeb('@playwright/test');

export function out(...parts) {
  const dir = join(OUT, ...parts.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(dir, parts.at(-1));
}

export function saveJson(name, value) {
  writeFileSync(out(name), JSON.stringify(value, null, 2));
}

/** Start the disposable e2e backend; returns { url, pid, stop }. */
export async function startServer() {
  const child = spawn(
    process.execPath,
    ['--conditions=development', '--import', 'tsx', 'e2e/server.ts'],
    { cwd: `${REPO}/apps/web`, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const url = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('e2e server did not start in 60 s')), 60_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const match = /GG_E2E_READY (\S+)/.exec(buffer);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`e2e server exited early (${code})`));
    });
  });
  return {
    url,
    pid: child.pid,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.stdin.end('stop\n');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      if (child.exitCode === null) child.kill();
    },
  };
}

export async function launch() {
  // The repository's Windows default: the installed Edge.
  return chromium.launch({ channel: 'msedge', headless: true });
}

/** A context for one viewport/theme/pointer combination. */
export async function context(browser, { url, width, height = 900, theme, touch, forced, dsf = 1 }) {
  const ctx = await browser.newContext({
    baseURL: url,
    viewport: { width, height },
    hasTouch: Boolean(touch),
    deviceScaleFactor: dsf,
    colorScheme: theme,
    forcedColors: forced ? 'active' : 'none',
    serviceWorkers: 'block',
  });
  await ctx.addInitScript((t) => localStorage.setItem('graphgoblin-theme', t), theme);
  return ctx;
}

async function api(base, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}
export const getJson = (base, path) => api(base, 'GET', path);

/** approve -> exit loop whose start and wait nodes carry `inputSchema` (undefined = none). */
export async function publishLoop(base, name, startSchema, waitSchema, returns) {
  const config = (schema, extra) => ({ ...extra, ...(schema ? { inputSchema: schema } : {}) });
  const definition = {
    schemaVersion: 4,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: config(startSchema, { type: 'manual' }), ui: { x: 0, y: 80 } },
      { id: 'approve', kind: 'wait', label: 'Approve', config: config(waitSchema, { mode: 'input', prompt: 'Approve?' }), ui: { x: 260, y: 80 } },
      { id: 'done', kind: 'exit', label: 'Done', config: returns ? { returns } : {}, ui: { x: 520, y: 80 } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'approve' } },
      { id: 'e2', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const created = await api(base, 'POST', '/loops', { definition });
  await api(base, 'POST', `/loops/${created.loop.id}/publish`);
  return created.loop.id;
}

/** The schema used for the visual states: every field kind the form offers. */
export const VISUAL_SCHEMA = {
  type: 'object',
  required: ['reason'],
  properties: {
    untouched: { type: 'string' },
    comment: { type: 'string' },
    message: { type: 'string' },
    title: { type: 'string', minLength: 1 },
    reason: { type: 'string' },
    number: { type: 'number' },
    metadata: { type: 'null' },
    payload: { type: 'object', description: 'A JSON property' },
    approved: { type: 'boolean' },
    mode: { enum: ['', 'fast', 'slow'] },
  },
};
