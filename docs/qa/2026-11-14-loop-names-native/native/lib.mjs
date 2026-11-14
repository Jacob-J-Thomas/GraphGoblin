// Shared helpers for the #209 phase 2 native/visual capture scripts. Not part of the repository.
// Starts the BUILT api (apps/api/dist/main.js, real SQLite file store in a throwaway data dir, port != 4747/4748)
// and drives real Edge with the Playwright library from the worktree's own node_modules.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export const WORKTREE = 'C:/Users/98jak/.codex/worktrees/gg-20261114-loop-names/GraphGoblin';
export const QA = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/ui-209-claude-phase2';
export const NODE = process.execPath;

const pw = await import(
  'file:///C:/Users/98jak/.codex/worktrees/gg-20261114-loop-names/GraphGoblin/apps/web/node_modules/@playwright/test/index.mjs'
);
export const { chromium } = pw;

/** Start the built API on `port` with a fresh data dir. Returns { url, pid, stop() }. */
export async function startNative({ port, dataDir, label }) {
  if ([4747, 4748].includes(port)) throw new Error('refusing owner ports');
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const logFile = join(dataDir, '..', `${label}-gateway.log`);
  writeFileSync(logFile, '');
  const child = spawn(NODE, [join(WORKTREE, 'apps/api/dist/main.js')], {
    cwd: WORKTREE,
    env: {
      ...process.env,
      GG_PORT: String(port),
      GG_HOST: '127.0.0.1',
      GG_DATA_DIR: dataDir,
      GG_LOG_LEVEL: 'warn',
      GG_SWAGGER_UI: 'false',
      GG_OLLAMA_ENABLED: 'false',
      GG_WEB_DIST: join(WORKTREE, 'apps/web/dist'),
      GG_GOBLIN_DIST: join(WORKTREE, 'apps/web/dist-goblin'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => appendFileSync(logFile, d));
  child.stderr.on('data', (d) => appendFileSync(logFile, d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`native gateway exited early (${child.exitCode}); see ${logFile}`);
    try {
      const r = await fetch(`${url}/loops`);
      if (r.ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) throw new Error('native gateway did not start in 60 s');
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    url,
    pid: child.pid,
    logFile,
    stop() {
      if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    },
    unref() {
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    },
  };
}

export async function api(url, method, path, body, headers = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: response.status, json };
}

/** A manual trigger, a wait-for-input node, and an exit (same shape as e2e/fixtures.ts approvalLoop). */
export function approvalLoop(name) {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
      { id: 'approve', kind: 'wait', label: 'Approve', config: { mode: 'input', prompt: 'Approve?' }, ui: { x: 260, y: 80 } },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 520, y: 80 } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'approve' } },
      { id: 'e2', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

export function equivalent(name) {
  return ` ${name.toUpperCase().replaceAll(' ', '  ')} `;
}

export function stamp() {
  return new Date().toISOString();
}

export async function launchEdge() {
  return chromium.launch({ channel: 'msedge', headless: true });
}

export async function contextFor(browser, { theme, width, height, forcedColors, url }) {
  const context = await browser.newContext({
    viewport: { width, height },
    baseURL: url,
    forcedColors: forcedColors ?? 'none',
    colorScheme: theme === 'light' ? 'light' : 'dark',
    serviceWorkers: 'block',
  });
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem('graphgoblin-theme', t);
    } catch {
      /* ignore */
    }
  }, theme);
  return context;
}
