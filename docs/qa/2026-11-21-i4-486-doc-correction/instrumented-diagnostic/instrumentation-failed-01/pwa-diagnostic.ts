import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, TestInfo } from '@playwright/test';

const root = process.env['GG_PWA_DIAGNOSTIC_DIR'];
const attempt = process.env['GG_PWA_DIAGNOSTIC_ATTEMPT'];
if (!root || !attempt) throw new Error('Missing isolated diagnostic output binding');
const directory = join(root, 'attempts', attempt);
mkdirSync(directory, { recursive: true });
const log = (kind: string, details: unknown) => appendFileSync(join(directory, 'events.jsonl'),
  JSON.stringify({ kind, nodePid: process.pid, utc: new Date().toISOString(), hrtime: process.hrtime.bigint().toString(), details }) + '\n');

export function diagnosticFailure(stage: string, error: unknown): void {
  log(stage, error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error));
}

export async function installDiagnostic(context: BrowserContext, browser: Browser, info: TestInfo) {
  log('test-start', { title: info.title, retry: info.retry, timeout: info.timeout, browserVersion: browser.version(), platform: process.platform, node: process.version });
  context.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('__GG_PWA_DIAG__')) {
      try { log('protocol', JSON.parse(text.slice('__GG_PWA_DIAG__'.length))); }
      catch { log('instrumentation-parse-error', text.slice(0, 500)); }
    }
  });
  context.on('serviceworker', (worker) => log('serviceworker-created', { url: worker.url() }));
  context.on('page', (page) => {
    log('page-created', {});
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) log('main-frame-navigation', { url: frame.url() }); });
    page.on('close', () => log('page-closed', {}));
    page.on('dialog', dialog => log('dialog', { type: dialog.type() }));
    void context.newCDPSession(page).then(async session => {
      session.on('ServiceWorker.workerVersionUpdated', data => log('worker-versions', data));
      session.on('ServiceWorker.workerRegistrationUpdated', data => log('worker-registrations', data));
      await session.send('ServiceWorker.enable');
    }).catch(error => diagnosticFailure('cdp-observer-error', error));
  });
  let sampling = false;
  let stopped = false;
  const sample = async () => {
    if (sampling || stopped) return;
    sampling = true;
    try {
      for (const page of context.pages()) {
        if (page.isClosed() || !page.url().startsWith('http://127.0.0.1:')) continue;
        try {
          const state = await page.evaluate(async () => {
            const registration = await navigator.serviceWorker.getRegistration('/app/');
            const locks = await navigator.locks.query();
            const scoped = (items: typeof locks.held) => items?.filter(lock => lock.name?.startsWith('graphgoblin-chat-update-v1:'));
            const worker = (value: ServiceWorker | null | undefined) => value ? { state: value.state, scriptURL: value.scriptURL } : null;
            return { at: performance.now(), timeOrigin: performance.timeOrigin, path: location.pathname,
              active: worker(registration?.active), waiting: worker(registration?.waiting), installing: worker(registration?.installing),
              controller: worker(navigator.serviceWorker.controller), held: scoped(locks.held), pending: scoped(locks.pending),
              toast: Array.from(document.querySelectorAll('[role="status"]')).map(node => node.textContent?.slice(0, 300)) };
          });
          log('page-state', state);
        } catch (error) { if (!page.isClosed()) diagnosticFailure('sample-error', error); }
      }
    } finally { sampling = false; }
  };
  const timer = setInterval(() => { void sample(); }, 1000);
  return () => { stopped = true; clearInterval(timer); log('test-end', { title: info.title, status: info.status, errors: info.errors }); };
}
