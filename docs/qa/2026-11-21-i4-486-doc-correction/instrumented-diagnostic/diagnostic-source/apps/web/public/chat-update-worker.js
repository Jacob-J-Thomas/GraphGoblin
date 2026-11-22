/* global self, navigator, MessageChannel, AbortController, setTimeout, clearTimeout */
// Loaded before generateSW's message listener. No audio, transcript or credential enters messages.
(() => {
  const protocol = 'graphgoblin-chat-update-v1';
  // This production generation's bundled bootstrap gates dirty actions before the first paint.
  // Bump when that startup/lease contract changes; older shells must close before upgrading.
  const generation = 'chat-session-web-lock-v1';
  const scope = self.registration.scope;
  const lockName = `${protocol}:${scope}`;
  const dirtyReason =
    'Finish or discard voice drafts and resolve pending messages in all open tabs before updating.';
  const unknownReason =
    'The update could not be verified. Return to the other tabs, or close and reopen all app windows.';
  const unsupportedReason =
    'This browser cannot safely update open voice sessions. Close all app windows to finish updating.';
  const legacyReason =
    'An older version is still running. Close all app windows to finish updating.';
  let applying = false;
  const diagnostic = (stage, details = {}) => {
    console.info('__GG_PWA_DIAG__' + JSON.stringify({ realm: 'worker', stage, at: performance.now(), timeOrigin: performance.timeOrigin, ...details }));
  };
  const lockSnapshot = (stage, attempt) => {
    void navigator.locks?.query().then((locks) => diagnostic(stage, { attempt,
      held: locks.held?.filter((lock) => lock.name === lockName),
      pending: locks.pending?.filter((lock) => lock.name === lockName) }));
  };


  const compatibleActiveWorker = (attempt) =>
    new Promise((resolve) => {
      const active = self.registration.active;
      diagnostic('active-capability-start', { attempt, state: active?.state });
      if (!active || active.state !== 'activated') {
        resolve(false);
        return;
      }
      const channel = new MessageChannel();
      const finish = (safe) => {
        diagnostic('active-capability-result', { attempt, safe });
        clearTimeout(timer);
        channel.port1.close();
        resolve(safe);
      };
      const timer = setTimeout(() => finish(false), 2_000);
      channel.port1.onmessage = (event) => {
        const data = event.data;
        finish(
          data?.protocol === protocol &&
            data.scope === scope &&
            data.attempt === attempt &&
            data.generation === generation,
        );
      };
      try {
        active.postMessage({ protocol, scope, type: 'CAPABILITY', attempt }, [channel.port2]);
      } catch {
        finish(false);
      }
    });

  const scopedClients = async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const selected = clients.filter((client) => client.url.startsWith(scope));
    diagnostic('scoped-clients', { clients: selected.map((client) => ({ id: client.id, path: new URL(client.url).pathname })) });
    return selected;
  };

  const tell = (client, type, attempt) => {
    try {
      diagnostic('tell', { attempt, type, clientId: client.id });
      client.postMessage({ protocol, scope, type, attempt });
    } catch {
      // A document can close after matchAll; its gone audio cannot be preserved by reloading it.
    }
  };

  const prepare = (client, attempt) =>
    new Promise((resolve) => {
      diagnostic('prepare-start', { attempt, clientId: client.id });
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        diagnostic('prepare-timeout', { attempt, clientId: client.id });
        channel.port1.close();
        resolve('unknown');
      }, 2_000);
      channel.port1.onmessage = (event) => {
        const data = event.data;
        if (!data || data.protocol !== protocol || data.attempt !== attempt) return;
        clearTimeout(timer);
        channel.port1.close();
        diagnostic('prepare-reply', { attempt, clientId: client.id, safe: data.safe });
        resolve(data.safe === true ? 'safe' : data.safe === false ? 'dirty' : 'unknown');
      };
      client.postMessage({ protocol, scope, type: 'PREPARE', attempt }, [channel.port2]);
    });

  // Keep the exclusive lock until activation has actually finished, including activate waitUntil.
  const activate = async () => {
    const worker = self.registration.waiting;
    diagnostic('activate-start', { waiting: worker?.state, active: self.registration.active?.state });
    if (!worker || worker.scriptURL !== self.location.href)
      throw new Error('not the waiting worker');
    const activated = new Promise((resolve) => {
      const changed = () => {
        diagnostic('activation-state', { state: worker.state });
        if (worker.state !== 'activated' && worker.state !== 'redundant') return;
        worker.removeEventListener('statechange', changed);
        resolve(worker.state === 'activated');
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
    diagnostic('skip-waiting-start');
    await self.skipWaiting();
    diagnostic('skip-waiting-resolved');
    if (!(await activated)) throw new Error('worker did not activate');
    diagnostic('activate-resolved');
  };

  const apply = async (event) => {
    const { attempt } = event.data;
    diagnostic('apply-received', { attempt, applying, sourceId: event.source?.id });
    lockSnapshot('apply-locks', attempt);
    const port = event.ports[0];
    const reply = (accepted, reason) => {
      diagnostic('apply-reply', { attempt, accepted, reason });
      port?.postMessage({ protocol, attempt, accepted, ...(reason ? { reason } : {}) });
    };
    if (applying) {
      reply(false, unknownReason);
      return;
    }
    if (!navigator.locks) {
      reply(false, unsupportedReason);
      return;
    }
    applying = true;
    // Existing clean acks cannot prove that a newly opened pre-guard cached shell will take a
    // shared lease. The first upgrade from such a worker must wait for all app windows to close.
    if (!(await compatibleActiveWorker(attempt))) {
      applying = false;
      reply(false, legacyReason);
      return;
    }
    const abort = new AbortController();
    const prepared = new Map();
    let ready;
    const preparation = new Promise((resolve) => {
      ready = resolve;
    });
    let accepted = false;
    let reason = unknownReason;
    let timer;
    // Queue the exclusive lock FIRST. A new page must acquire shared before creating dirty state,
    // so it cannot slip between the final clients snapshot and worker activation.
    diagnostic('exclusive-queued', { attempt });
    const exclusive = navigator.locks.request(
      lockName,
      { mode: 'exclusive', signal: abort.signal },
      async () => {
        diagnostic('exclusive-granted', { attempt });
        lockSnapshot('exclusive-locks', attempt);
        if (!(await preparation)) return;
        diagnostic('preparation-accepted', { attempt });
        clearTimeout(timer);
        const current = await scopedClients();
        for (const client of current) {
          if (prepared.has(client.id)) continue;
          prepared.set(client.id, client);
          const safety = await prepare(client, attempt);
          if (safety !== 'safe') {
            if (safety === 'dirty') reason = dirtyReason;
            throw new Error('client safety unknown');
          }
        }
        // Existing pages remain locally frozen through controllerchange/reload. New pages remain
        // behind this worker's exclusive lock until the new worker is fully activated.
        for (const client of prepared.values()) tell(client, 'COMMIT', attempt);
        await activate();
        accepted = true;
        diagnostic('accepted', { attempt });
      },
    );
    void exclusive.catch(() => undefined);
    try {
      const clients = await scopedClients();
      if (!clients.some((client) => client.id === event.source?.id))
        throw new Error('unknown requester');
      for (const client of clients) prepared.set(client.id, client);
      const checks = await Promise.all(clients.map((client) => prepare(client, attempt)));
      diagnostic('checks-complete', { attempt, checks });
      if (checks.some((safety) => safety !== 'safe')) {
        reason = checks.includes('dirty') ? dirtyReason : unknownReason;
        ready(false);
        abort.abort();
      } else {
        ready(true);
        // An unresponsive/older tab that still owns a shared lease is a veto, not an expired vote.
        timer = setTimeout(() => { diagnostic('exclusive-timeout', { attempt }); abort.abort(); }, 2_000);
      }
      await exclusive;
    } catch {
      ready(false);
      abort.abort();
      // Always observe lock rejection, including cancellation before its callback starts.
      await exclusive.catch(() => undefined);
    } finally {
      diagnostic('apply-finally', { attempt, accepted, reason });
      clearTimeout(timer);
      if (!accepted) {
        for (const client of prepared.values()) tell(client, 'ABORT', attempt);
      }
      applying = false;
      reply(accepted, accepted ? undefined : reason);
    }
  };

  self.addEventListener('activate', () => diagnostic('worker-activate-event'));
  self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
      // generateSW also adds this listener; stop it from bypassing the safety barrier.
      event.stopImmediatePropagation();
      return;
    }
    if (
      event.data?.protocol !== protocol ||
      event.data.scope !== scope ||
      typeof event.data.attempt !== 'string'
    )
      return;
    if (event.data.type === 'CAPABILITY') {
      event.ports[0]?.postMessage({ protocol, scope, attempt: event.data.attempt, generation });
      return;
    }
    if (event.data.type !== 'APPLY') return;
    event.stopImmediatePropagation();
    event.waitUntil(apply(event));
  });
})();
