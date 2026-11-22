import hashlib
import json
from pathlib import Path
import subprocess

P=Path(__file__).resolve().parent
R=Path('G:/ggq/gg-i4-553-browser-diagnostic/GraphGoblin')
BASE='29e165e14fdda138300ba2a34585ddd47268b475'
changed=[]

# Restore only this task's diagnostic-owned files from the immutable base before generation.
for owned in ['apps/web/public/chat-update-worker.js', 'apps/web/src/pwa/chat-update-guard.ts',
              'apps/web/src/pwa/register.ts', 'apps/web/e2e/pwa.spec.ts', 'apps/web/e2e/global-setup.ts']:
    (R/owned).write_bytes(subprocess.check_output(['git','-C',str(R),'show',BASE+':'+owned]))

def edit(path, replacements):
    f=R/path
    original=f.read_bytes()
    source=original.decode('utf8')
    for old,new,count in replacements:
        actual=source.count(old)
        if actual!=count:raise ValueError((path,old,actual,count))
        source=source.replace(old,new)
    f.write_text(source,encoding='utf8',newline='')
    changed.append({'path':path,'baseSha256':hashlib.sha256(original).hexdigest(),
                    'diagnosticSha256':hashlib.sha256(f.read_bytes()).hexdigest()})

helper=r'''import { appendFileSync, mkdirSync } from 'node:fs';
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
'''
(R/'apps/web/e2e/pwa-diagnostic.ts').write_text(helper,encoding='utf8')
changed.append({'path':'apps/web/e2e/pwa-diagnostic.ts','newDiagnosticOnly':True,
                'diagnosticSha256':hashlib.sha256(helper.encode()).hexdigest()})

worker_log="""  const diagnostic = (stage, details = {}) => {
    console.info('__GG_PWA_DIAG__' + JSON.stringify({ realm: 'worker', stage, at: performance.now(), timeOrigin: performance.timeOrigin, ...details }));
  };
  const lockSnapshot = (stage, attempt) => {
    void navigator.locks?.query().then((locks) => diagnostic(stage, { attempt,
      held: locks.held?.filter((lock) => lock.name === lockName),
      pending: locks.pending?.filter((lock) => lock.name === lockName) }));
  };
"""
edit('apps/web/public/chat-update-worker.js',[
 ('  let applying = false;','  let applying = false;\n'+worker_log,1),
 ('      const active = self.registration.active;','      const active = self.registration.active;\n      diagnostic(\'active-capability-start\', { attempt, state: active?.state });',1),
 ('      const finish = (safe) => {','      const finish = (safe) => {\n        diagnostic(\'active-capability-result\', { attempt, safe });',1),
 ("    return clients.filter((client) => client.url.startsWith(scope));","    const selected = clients.filter((client) => client.url.startsWith(scope));\n    diagnostic('scoped-clients', { clients: selected.map((client) => ({ id: client.id, path: new URL(client.url).pathname })) });\n    return selected;",1),
 ('      client.postMessage({ protocol, scope, type, attempt });',"      diagnostic('tell', { attempt, type, clientId: client.id });\n      client.postMessage({ protocol, scope, type, attempt });",1),
 ('      const channel = new MessageChannel();\n      const timer = setTimeout(() => {',"      diagnostic('prepare-start', { attempt, clientId: client.id });\n      const channel = new MessageChannel();\n      const timer = setTimeout(() => {\n        diagnostic('prepare-timeout', { attempt, clientId: client.id });",1),
 ("        resolve(data.safe === true ? 'safe' : data.safe === false ? 'dirty' : 'unknown');","        diagnostic('prepare-reply', { attempt, clientId: client.id, safe: data.safe });\n        resolve(data.safe === true ? 'safe' : data.safe === false ? 'dirty' : 'unknown');",1),
 ('    const worker = self.registration.waiting;',"    const worker = self.registration.waiting;\n    diagnostic('activate-start', { waiting: worker?.state, active: self.registration.active?.state });",1),
 ('      const changed = () => {',"      const changed = () => {\n        diagnostic('activation-state', { state: worker.state });",1),
 ('    await self.skipWaiting();',"    diagnostic('skip-waiting-start');\n    await self.skipWaiting();\n    diagnostic('skip-waiting-resolved');",1),
 ("    if (!(await activated)) throw new Error('worker did not activate');","    if (!(await activated)) throw new Error('worker did not activate');\n    diagnostic('activate-resolved');",1),
 ('    const { attempt } = event.data;',"    const { attempt } = event.data;\n    diagnostic('apply-received', { attempt, applying, sourceId: event.source?.id });\n    lockSnapshot('apply-locks', attempt);",1),
 ('    const reply = (accepted, reason) =>\n      port?.postMessage({ protocol, attempt, accepted, ...(reason ? { reason } : {}) });',"    const reply = (accepted, reason) => {\n      diagnostic('apply-reply', { attempt, accepted, reason });\n      port?.postMessage({ protocol, attempt, accepted, ...(reason ? { reason } : {}) });\n    };",1),
 ('    const exclusive = navigator.locks.request(',"    diagnostic('exclusive-queued', { attempt });\n    const exclusive = navigator.locks.request(",1),
 ('      async () => {\n        if (!(await preparation)) return;',"      async () => {\n        diagnostic('exclusive-granted', { attempt });\n        lockSnapshot('exclusive-locks', attempt);\n        if (!(await preparation)) return;\n        diagnostic('preparation-accepted', { attempt });",1),
 ('        accepted = true;',"        accepted = true;\n        diagnostic('accepted', { attempt });",1),
 ('      const checks = await Promise.all(clients.map((client) => prepare(client, attempt)));',"      const checks = await Promise.all(clients.map((client) => prepare(client, attempt)));\n      diagnostic('checks-complete', { attempt, checks });",1),
 ('        timer = setTimeout(() => abort.abort(), 2_000);',"        timer = setTimeout(() => { diagnostic('exclusive-timeout', { attempt }); abort.abort(); }, 2_000);",1),
 ('    } finally {\n      clearTimeout(timer);',"    } finally {\n      diagnostic('apply-finally', { attempt, accepted, reason });\n      clearTimeout(timer);",1),
 ("  self.addEventListener('message', (event) => {","  self.addEventListener('activate', () => diagnostic('worker-activate-event'));\n  self.addEventListener('message', (event) => {",1),
])

page_log="""function diagnostic(stage: string, details: Record<string, unknown> = {}): void {
  console.info('__GG_PWA_DIAG__' + JSON.stringify({ realm: 'page-guard', stage, at: performance.now(), timeOrigin: performance.timeOrigin, ...details }));
}

"""
edit('apps/web/src/pwa/chat-update-guard.ts',[
 ('const unresolvedSubmissions = new Set<string>();',page_log+'const unresolvedSubmissions = new Set<string>();',1),
 ('  const releaseLease = () => {',"  const releaseLease = () => {\n    diagnostic('release-lease', { owner, prepared: [...prepared] });",1),
 ('    const attempt = data.attempt;\n    const key',"    const attempt = data.attempt;\n    diagnostic('message', { owner, attempt, type: data.type, workerState: source.state });\n    const key",1),
 ('      const safe = lockChatUpdate(key) && !!locks && storageKnown;',"      const safe = lockChatUpdate(key) && !!locks && storageKnown;\n      diagnostic('prepare-ack', { owner, attempt, safe });",1),
 ('        const attempt = crypto.randomUUID();',"        const attempt = crypto.randomUUID();\n        diagnostic('apply-send', { owner, attempt, workerState: worker.state });",1),
 ('        const timer = setTimeout(() => {',"        const timer = setTimeout(() => {\n          diagnostic('apply-timeout', { owner, attempt });",1),
 ("          if (!result || result.protocol !== CHAT_UPDATE_PROTOCOL || result.attempt !== attempt)\n            return;\n          clearTimeout(timer);","          if (!result || result.protocol !== CHAT_UPDATE_PROTOCOL || result.attempt !== attempt)\n            return;\n          diagnostic('apply-result', { owner, attempt, accepted: result.accepted, reason: result.reason });\n          clearTimeout(timer);",1),
 ("    } else if (data.type === 'COMMIT' && prepared.has(attempt)) {\n      committed(source);","    } else if (data.type === 'COMMIT' && prepared.has(attempt)) {\n      diagnostic('commit', { owner, attempt });\n      committed(source);",1),
])

edit('apps/web/src/pwa/register.ts',[
 ('  const maybeReload = () => {',"  const diagnostic = (stage: string, details: Record<string, unknown> = {}) => console.info('__GG_PWA_DIAG__' + JSON.stringify({ realm: 'register', stage, at: performance.now(), timeOrigin: performance.timeOrigin, ...details }));\n  const maybeReload = () => {\n    diagnostic('maybe-reload', { disposed, reloadRequested, controlled, reloaded, unsafe: isChatUpdateUnsafe() });",1),
 ('      reloaded = true;\n      reload();',"      reloaded = true;\n      diagnostic('reload');\n      reload();",1),
 ('    committedWorker = worker;',"    diagnostic('committed', { state: worker.state, isController: navigator.serviceWorker?.controller === worker });\n    committedWorker = worker;",1),
 ("  wb.addEventListener('controlling', () => {","  wb.addEventListener('controlling', () => {\n    diagnostic('controlling', { committedState: committedWorker?.state, isCommittedController: navigator.serviceWorker?.controller === committedWorker });",1),
 ('      const result = await guard.apply(worker ?? registration?.waiting ?? undefined);',"      const result = await guard.apply(worker ?? registration?.waiting ?? undefined);\n      diagnostic('guard-result', { accepted: result.accepted, reason: result.reason });",1),
])

spec=R/'apps/web/e2e/pwa.spec.ts'
source=spec.read_text(encoding='utf8')
header="import { installDiagnostic, diagnosticFailure } from './pwa-diagnostic.js';\nlet stopDiagnostic: (() => void) | undefined;\ntest.beforeEach(async ({ context, browser }, info) => { stopDiagnostic = await installDiagnostic(context, browser, info); });\ntest.afterEach(() => { stopDiagnostic?.(); stopDiagnostic = undefined; });\n"
source=header+source
start=source.index("test('another tab’s unresolved voice upload vetoes")
end=source.index("test('a legacy active worker",start)
section=source[start:end]
old="  } finally {\n    if (!dirty.isClosed()) await dirty.close();\n    await control(request, '/worker/reset');\n  }"
new="""  } catch (error) {
    diagnosticFailure('first-body-error', error);
    throw error;
  } finally {
    if (!dirty.isClosed()) await dirty.close();
    try { await control(request, '/worker/reset'); }
    catch (error) { diagnosticFailure('cleanup-error', error); throw error; }
  }"""
if section.count(old)!=1:raise ValueError('Target cleanup anchor mismatch')
source=source[:start]+section.replace(old,new)+source[end:]
original=spec.read_bytes();spec.write_text(source,encoding='utf8',newline='')
changed.append({'path':'apps/web/e2e/pwa.spec.ts','baseSha256':hashlib.sha256(original).hexdigest(),
                'diagnosticSha256':hashlib.sha256(spec.read_bytes()).hexdigest()})

edit('apps/web/e2e/global-setup.ts',[
 ('  const url = await new Promise<string>',"  console.error('__GG_PWA_SERVER_PID__' + JSON.stringify({ pid: child.pid, parentPid: process.pid }));\n  const url = await new Promise<string>",1),
])

patch=subprocess.check_output(['git','-C',str(R),'diff','--binary'])
(P/'diagnostic.patch').write_bytes(patch)
(P/'diagnostic-files.json').write_text(json.dumps({'base':BASE,'files':changed},indent=2)+'\n',encoding='utf8')
copies=P/'diagnostic-source';copies.mkdir(exist_ok=False)
for row in changed:
    target=copies/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((R/row['path']).read_bytes())
print(json.dumps({'changedFiles':len(changed),'patchBytes':len(patch),'patchSha256':hashlib.sha256(patch).hexdigest()}))
