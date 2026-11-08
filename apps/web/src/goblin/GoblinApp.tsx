import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatSurface } from '../chat/ChatSurface.js';
import { ChatApiError, createChatClient } from '../chat/client.js';
import { GoblinMark, Icon } from '../components/icons/index.js';
import { Button, ConfirmAction, Dialog } from '../components/ui/index.js';
import { useOnline } from '../lib/online.js';
import {
  DEVICE_CREDENTIAL_KEY,
  CredentialStorageError,
  GOBLIN_CHAT_STORAGE_KEY,
  forgetDevice,
  readDeviceRecord,
  type DeviceRecord,
} from './credentials.js';
import { PairScreen } from './PairScreen.js';
import { installationGuidance, useInstall } from './useInstall.js';
import { capturePairingCode } from './connection.js';

type Connection = 'checking' | 'connected' | 'unreachable';

export function GoblinApp({ initialCode }: { initialCode: string }) {
  const [initial] = useState(() => {
    try {
      return { record: readDeviceRecord(), notice: '' };
    } catch (cause) {
      return { record: undefined, notice: (cause as Error).message };
    }
  });
  const [record, setRecord] = useState<DeviceRecord | undefined>(initial.record);
  const [linkCode, setLinkCode] = useState(initialCode);
  const [pairLink, setPairLink] = useState(Boolean(initialCode));
  const [notice, setNotice] = useState(initial.notice);
  const [lostAccess, setLostAccess] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sheetNotice, setSheetNotice] = useState('');
  const explicitCheckRef = useRef(false);
  const [connection, setConnection] = useState<Connection>('checking');
  const [checked, setChecked] = useState<Date>();
  const [checkCount, setCheckCount] = useState(0);
  const [sessionLabel, setSessionLabel] = useState('');
  const online = useOnline();
  const install = useInstall();
  const device = record?.kind === 'device' ? record : undefined;
  const client = useMemo(
    () =>
      createChatClient({
        getToken: () => device?.deviceToken,
        fetch: (url, init) =>
          globalThis.fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' }),
      }),
    [device?.deviceToken],
  );
  useEffect(() => {
    if (device && !pairLink) document.getElementById('goblin-heading')?.focus();
  }, [device, pairLink]);

  useEffect(() => {
    const load = () => {
      try {
        setRecord(readDeviceRecord());
      } catch (cause) {
        setNotice((cause as Error).message);
      }
    };
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== DEVICE_CREDENTIAL_KEY) return;
      setNotice('');
      // Each tab owns its sessionStorage. Sign-out in a different tab also clears this draft.
      try {
        sessionStorage.removeItem(GOBLIN_CHAT_STORAGE_KEY);
      } catch {
        setNotice(new CredentialStorageError().message);
      }
      load();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);

  useEffect(() => {
    const capture = () => {
      const code = capturePairingCode();
      if (!code) return;
      setLinkCode(code);
      setPairLink(true);
      setLostAccess(false);
    };
    window.addEventListener('hashchange', capture);
    return () => window.removeEventListener('hashchange', capture);
  }, []);

  const loseAccess = useCallback(() => {
    setNotice('');
    setSheetNotice('');
    setSessionLabel('');
    setConnection('checking');
    try {
      forgetDevice();
    } catch (cause) {
      setNotice((cause as Error).message);
    }
    setRecord(undefined);
    setSheet(false);
    setLostAccess(true);
  }, []);

  useEffect(() => {
    if (!device || !online || pairLink) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let delay = 2_000;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const session = await client.session(controller.signal);
        if (controller.signal.aborted) return;
        if (session.audience.kind !== 'device') {
          loseAccess();
          return;
        }
        setSessionLabel(session.label);
        setConnection('connected');
        setChecked(new Date());
        if (explicitCheckRef.current) {
          setSheetNotice('Connected.');
          explicitCheckRef.current = false;
        }
        delay = 30_000;
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ChatApiError && cause.status === 401) {
          loseAccess();
          return;
        }
        setConnection('unreachable');
        if (explicitCheckRef.current) {
          setSheetNotice('Can’t reach the gateway.');
          explicitCheckRef.current = false;
        }
        delay = Math.min(delay * 2, 30_000);
      }
      timer = setTimeout(() => {
        void check();
      }, delay);
    };
    const visible = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') void check();
    };
    void check();
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [client, device, online, pairLink, checkCount, loseAccess]);

  function signOut(): Promise<void> {
    forgetDevice();
    setRecord(undefined);
    setSheet(false);
    setNotice('Signed out on this device.');
    return Promise.resolve();
  }
  const signOutConsequences = (
    <p>
      This browser forgets its pairing, unsent draft and the conversation shown here. The gateway
      keeps this device’s record, history and any requests already sent. To remove its access,
      revoke it on the gateway’s Devices page. A request in progress keeps running on the gateway.
    </p>
  );

  if (lostAccess)
    return (
      <main className="mx-auto grid min-h-[100dvh] max-w-[29rem] content-center justify-items-center gap-4 px-page text-center">
        <GoblinMark className="size-12 opacity-60" />
        <h1 autoFocus tabIndex={-1} className="text-2xl font-semibold text-heading">
          This device no longer has access
        </h1>
        <p className="text-sm text-muted">
          Its pairing isn’t accepted anymore, and unsent text here was cleared. To keep chatting,
          pair it again with a new link from the gateway.
        </p>
        {notice ? (
          <p role="alert" className="text-sm text-status-bad-fg">
            {notice}
          </p>
        ) : null}
        <Button
          className="h-11 w-full"
          onClick={() => {
            setLostAccess(false);
            setNotice('');
          }}
        >
          Pair again
        </Button>
      </main>
    );
  if (device && pairLink)
    return (
      <main className="mx-auto grid min-h-[100dvh] max-w-[29rem] content-center justify-items-center gap-4 px-page text-center">
        <GoblinMark className="size-12" />
        <h1 tabIndex={-1} autoFocus className="text-2xl font-semibold text-heading">
          This device is already paired
        </h1>
        <p className="text-sm text-muted">
          It’s paired as {device.label} with {window.location.host}. To use the new link, sign out
          on this device first.
        </p>
        <Button variant="outline" onClick={() => setPairLink(false)}>
          Keep current pairing
        </Button>
        <ConfirmAction
          action="sign-out"
          name={device.label}
          accessibleName="Sign out and pair"
          triggerLabel="Sign out and pair"
          consequences={signOutConsequences}
          onConfirm={() => {
            forgetDevice();
            setRecord(undefined);
            setNotice('Signed out on this device.');
            return Promise.resolve();
          }}
        />
      </main>
    );
  if (!device || pairLink)
    return (
      <PairScreen
        key={`${record?.kind ?? 'empty'}:${pairLink ? linkCode : ''}`}
        initialCode={pairLink ? linkCode : ''}
        {...(record?.kind === 'pending' ? { pending: record } : {})}
        online={online}
        notice={notice}
        install={install}
        onPaired={(paired) => {
          setRecord(paired);
          setNotice(`Paired as ${paired.label}.`);
          setPairLink(false);
        }}
      />
    );

  const status = !online
    ? 'Offline'
    : connection === 'checking'
      ? 'Connecting…'
      : connection === 'connected'
        ? 'Connected'
        : 'Can’t reach gateway';
  const dot =
    !online || connection === 'unreachable'
      ? 'bg-status-bad-border'
      : connection === 'checking'
        ? 'bg-status-warn-border'
        : 'bg-accent';
  return (
    <>
      <header className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-2 border-b border-inverse bg-surface-inverse px-[max(1rem,env(safe-area-inset-left))] py-2 text-inverse">
        <h1 id="goblin-heading" tabIndex={-1} className="sr-only">
          Goblin
        </h1>
        <a
          href="./"
          className="inline-flex items-center gap-2 font-display text-lg font-semibold text-inverse no-underline"
        >
          <GoblinMark className="size-7" />
          Goblin
        </a>
        <span
          data-testid="goblin-status"
          className="ml-1 flex min-w-0 flex-1 items-center gap-2 font-mono text-xs text-inverse-muted"
        >
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
          <span>{status}</span>
          <span className="hidden min-[400px]:inline">
            / <span className="break-all">{window.location.host}</span>
          </span>
        </span>
        {install ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-inverse"
            onClick={() => {
              void install().catch(() =>
                setNotice('Use your browser’s install option to install Goblin.'),
              );
            }}
          >
            Install
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-11 text-inverse"
          aria-label="Gateway"
          aria-haspopup="dialog"
          onClick={() => {
            setSheet(true);
            setSheetNotice(online ? '' : 'You’re offline.');
          }}
        >
          <Icon name="sliders" />
        </Button>
      </header>
      {notice ? (
        <p role="status" className="mx-auto max-w-[47.5rem] px-page pt-3 text-sm text-muted">
          {notice}
        </p>
      ) : null}
      <ChatSurface
        client={client}
        storageKey={GOBLIN_CHAT_STORAGE_KEY}
        onAuthenticationError={loseAccess}
        sessionRefreshKey={checkCount}
      />
      <Dialog
        open={sheet}
        onClose={() => setSheet(false)}
        title="Gateway"
        description="What this device chats with."
      >
        <dl className="grid gap-4 text-sm">
          <div>
            <dt className="font-medium text-muted">Status</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-3">
              {status}
              {checked && online && connection === 'connected'
                ? ` · checked ${checked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : ''}
              <Button
                size="sm"
                variant="outline"
                disabled={!online}
                onClick={() => {
                  explicitCheckRef.current = true;
                  setConnection('checking');
                  setCheckCount((count) => count + 1);
                }}
              >
                Check connection
              </Button>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-muted">Address</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-3 font-mono wrap-anywhere">
              {window.location.origin}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(window.location.origin).then(
                    () => setSheetNotice('Address copied.'),
                    () =>
                      setSheetNotice('Couldn’t copy the address. Select it and copy it yourself.'),
                  );
                  if (!navigator.clipboard)
                    setSheetNotice('Couldn’t copy the address. Select it and copy it yourself.');
                }}
              >
                Copy address
              </Button>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-muted">This device</dt>
            <dd className="mt-1">
              {sessionLabel || device.label}
              <p className="mt-1 text-xs text-muted">Rename it on the gateway.</p>
            </dd>
          </div>
        </dl>
        <div className="mt-5 grid gap-4 border-t border-default pt-5">
          {install ? (
            <Button
              variant="outline"
              onClick={() => {
                void install().catch(() =>
                  setNotice('Use your browser’s install option to install Goblin.'),
                );
              }}
            >
              Install Goblin
            </Button>
          ) : (
            <p className="text-xs text-muted">{installationGuidance()}</p>
          )}
          <p className="text-xs text-muted">
            Loops, models and keys stay on the gateway. This device can only chat.
          </p>
          <ConfirmAction
            action="sign-out"
            name={device.label}
            accessibleName="Sign out on this device"
            consequences={signOutConsequences}
            onConfirm={signOut}
          />
          <p role="status" className="text-xs text-muted">
            {sheetNotice}
          </p>
        </div>
      </Dialog>
    </>
  );
}
