import type { ChatDevice, ChatPairingCreated, ChatPairingReadiness } from '@graphgoblin/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { GoblinMark } from '../components/icons/Logo.js';
import { Icon } from '../components/icons/index.js';
import { Page, PageHeader } from '../components/layout/index.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmAction,
  Dialog,
  FieldGroup,
  Input,
  Label,
  Table,
  Td,
  Th,
} from '../components/ui/index.js';
import { formatDateTime } from '../lib/utils.js';
import { ChatApiError, type ChatClient } from './client.js';
import { PairingQr } from './PairingQr.js';
const errorText = (error: unknown) =>
  error instanceof ChatApiError
    ? error.message
    : 'The gateway could not be reached. Check the connection and try again.';
function PairDialog({ client, onClose }: { client: ChatClient; onClose: () => void }) {
  const [pairing, setPairing] = useState<ChatPairingCreated>();
  const [readiness, setReadiness] = useState<ChatPairingReadiness>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [errorAction, setErrorAction] = useState<'check' | 'create'>('check');
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState<'code' | 'link'>();
  const [copyError, setCopyError] = useState<'code' | 'link'>();
  const [now, setNow] = useState(() => Date.now());
  const startedRef = useRef(false);
  const busyRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const newLinkRef = useRef<HTMLButtonElement>(null);
  const focusExpiredRef = useRef(false);
  const check = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setReadiness(await client.pairingReadiness());
    } catch (failure) {
      setErrorAction('check');
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }, [client]);
  const create = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setCopyError(undefined);
    setStatus('');
    try {
      setPairing(await client.createPairing());
      setNow(Date.now());
    } catch (failure) {
      setErrorAction('create');
      if (failure instanceof ChatApiError && failure.status === 409) setReadiness(undefined);
      setError(errorText(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [client]);
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      void check();
    }
  }, [check]);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);
  useEffect(() => {
    if (!pairing) return;
    let minuteAnnounced = false;
    let expired = false;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      const remaining = Date.parse(pairing.expiresAt) - current;
      if (remaining <= 0 && !expired) {
        expired = true;
        focusExpiredRef.current = document.activeElement?.hasAttribute('data-pair-copy') === true;
        setStatus('Pairing link expired.');
      } else if (remaining > 0 && remaining <= 60_000 && !minuteAnnounced) {
        minuteAnnounced = true;
        setStatus('Pairing link expires in 1 minute.');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [pairing]);
  const expired = pairing && Date.parse(pairing.expiresAt) <= now;
  useEffect(() => {
    if (expired && focusExpiredRef.current) {
      focusExpiredRef.current = false;
      newLinkRef.current?.focus();
    }
  }, [expired]);
  const copy = async (kind: 'code' | 'link') => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(kind === 'code' ? pairing.code : pairing.url!);
      setCopied(kind);
      setCopyError(undefined);
      setStatus(kind === 'code' ? 'Code copied.' : 'Pairing link copied.');
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(undefined), 2000);
    } catch {
      setCopyError(kind);
    }
  };
  const address = pairing?.url ? pairing.url.split('#')[0] : undefined;
  return (
    <Dialog
      open
      title="Pair a device"
      description="Use this link or code on the device you want to pair. Anyone who has it can pair a device, so share it only with that device."
      closeOnBackdrop={false}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="grid gap-4" aria-busy={busy}>
        {busy ? (
          <p role="status">{readiness ? 'Creating a pairing link…' : 'Checking pairing setup…'}</p>
        ) : error ? (
          <>
            <Alert
              title={
                errorAction === 'check'
                  ? 'Couldn’t check pairing setup.'
                  : 'Couldn’t create a pairing link.'
              }
            >
              {error}
            </Alert>
            <Button onClick={() => void (readiness?.ready ? create() : check())}>Try again</Button>
          </>
        ) : !pairing && readiness ? (
          <section className="grid gap-3" aria-label="Pairing setup">
            <h2 className="font-semibold text-heading">
              {readiness.ready
                ? readiness.mode === 'same-machine'
                  ? 'This computer only'
                  : 'Home Wi-Fi pairing'
                : 'Finish gateway setup'}
            </h2>
            <p className="text-sm text-muted">{readiness.message}</p>
            {readiness.url ? (
              <p className="font-mono text-xs wrap-anywhere">{readiness.url}</p>
            ) : null}
            {readiness.ready ? (
              <Button onClick={() => void create()}>Generate pairing link</Button>
            ) : (
              <Button variant="outline" onClick={() => void check()}>
                Check setup again
              </Button>
            )}
            <p className="text-xs text-muted">
              A pairing code lasts 10 minutes. No code is created until you choose Generate.
            </p>
          </section>
        ) : pairing ? (
          expired ? (
            <>
              <Alert tone="warn">
                This pairing link expired at{' '}
                <time dateTime={pairing.expiresAt}>
                  {new Date(pairing.expiresAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                .
              </Alert>
              <Button ref={newLinkRef} onClick={() => void create()}>
                Create new link
              </Button>
            </>
          ) : (
            <>
              {readiness?.mode === 'same-machine' ? (
                <Alert tone="warn" title="This computer only">
                  This link uses a loopback address. Open it in a new tab, another browser or the
                  installed Goblin app on this computer. For a phone, set up a reachable HTTPS
                  gateway address first.
                </Alert>
              ) : null}
              <ol className="grid list-decimal gap-4 pl-5">
                <li>
                  <p className="mb-2 text-sm">
                    {readiness?.mode === 'same-machine'
                      ? 'Open Goblin on this computer'
                      : 'Send this link to the device'}
                  </p>
                  {pairing.url ? (
                    <>
                      {readiness?.mode === 'network' ? <PairingQr url={pairing.url} /> : null}
                      <a
                        href={pairing.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mb-3 block text-sm"
                      >
                        {readiness?.mode === 'same-machine'
                          ? 'Open Goblin on this computer'
                          : 'Open pairing link'}
                      </a>
                      <Button
                        data-pair-copy
                        className="max-sm:w-full"
                        onClick={() => void copy('link')}
                      >
                        <Icon name={copied === 'link' ? 'check' : 'copy'} />
                        {copied === 'link' ? 'Copied' : 'Copy pairing link'}
                      </Button>
                      <p className="mt-2 font-mono text-xs text-muted wrap-anywhere">
                        Opens {address}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted">
                      Open this gateway’s Goblin app on the device.
                    </p>
                  )}
                  {copyError === 'link' ? (
                    <>
                      <p role="alert" className="mt-2 text-sm text-status-bad-fg">
                        Couldn’t copy. Select the link below and copy it yourself.
                      </p>
                      <p
                        aria-label="Pairing link"
                        className="mt-2 rounded-lg bg-surface-sunken p-3 font-mono text-sm wrap-anywhere select-all"
                      >
                        {pairing.url}
                      </p>
                    </>
                  ) : null}
                  {readiness?.mode !== 'same-machine' ? (
                    <p className="mt-2 text-sm text-muted">
                      On the device, trust the gateway’s HTTPS certificate before pairing. You can
                      use the browser or install Goblin and pair inside that app.
                    </p>
                  ) : null}
                </li>
                <li>
                  <p className="mb-2 text-sm">
                    Or open that address on the device and paste this code
                  </p>
                  <span id="pairing-code-label" className="text-sm font-semibold">
                    Pairing code
                  </span>
                  <output
                    className="mt-2 block rounded-lg bg-surface-sunken p-3 font-mono text-sm leading-6 wrap-anywhere select-all"
                    aria-labelledby="pairing-code-label"
                  >
                    {pairing.code}
                  </output>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      data-pair-copy
                      size="sm"
                      variant="outline"
                      onClick={() => void copy('code')}
                    >
                      <Icon name={copied === 'code' ? 'check' : 'copy'} />
                      {copied === 'code' ? 'Copied' : 'Copy code'}
                    </Button>
                    <span className="text-xs text-muted">Case matters. 43 characters.</span>
                  </div>
                  {copyError === 'code' ? (
                    <p role="alert" className="mt-2 text-sm text-status-bad-fg">
                      Couldn’t copy. Select the code and copy it yourself.
                    </p>
                  ) : null}
                </li>
                <li className="text-sm">
                  In the installed app, or in that browser, name the device and tap Pair.
                </li>
              </ol>
              <p className="text-sm text-muted">
                Closing doesn’t cancel the link. It works until{' '}
                <time dateTime={pairing.expiresAt}>
                  {new Date(pairing.expiresAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>{' '}
                or until a device uses it. New devices appear in the list after you close this.
              </p>
            </>
          )
        ) : null}
        <p role="status" className="sr-only">
          {status}
        </p>
      </div>
    </Dialog>
  );
}
function RenameDialog({
  client,
  device,
  onClose,
  onSaved,
}: {
  client: ChatClient;
  device: ChatDevice;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState(device.label);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    if (!label.trim()) {
      setError('Enter a name.');
      return;
    }
    if (label.trim().length > 80) {
      setError('Use 80 characters or fewer.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await client.renameDevice(device.id, label.trim());
      await onSaved();
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title="Rename device"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <FieldGroup>
        <Label htmlFor="device-name" required>
          Device name
        </Label>
        <Input
          id="device-name"
          value={label}
          maxLength={80}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'device-name-error' : undefined}
          onChange={(event) => setLabel(event.target.value)}
        />
        {error ? (
          <p id="device-name-error" role="alert" className="text-sm text-status-bad-fg">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-muted">Renaming the device keeps its chat loop’s name.</p>
      </FieldGroup>
    </Dialog>
  );
}
export function DevicesPage({ client }: { client: ChatClient }) {
  const [devices, setDevices] = useState<ChatDevice[]>();
  const [error, setError] = useState<string>();
  const [pairing, setPairing] = useState(false);
  const [renaming, setRenaming] = useState<ChatDevice>();
  const load = useCallback(async () => {
    try {
      setDevices(await client.devices());
      setError(undefined);
    } catch (failure) {
      setError(errorText(failure));
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);
  const sorted = devices?.toSorted(
    (a, b) =>
      Number(Boolean(a.revokedAt)) - Number(Boolean(b.revokedAt)) ||
      (a.revokedAt && b.revokedAt
        ? b.revokedAt.localeCompare(a.revokedAt)
        : a.label.localeCompare(b.label)),
  );
  return (
    <Page>
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to="/chat">Chat</Link> /
      </nav>
      <PageHeader
        title="Devices"
        titleId="devices-heading"
        actions={
          devices?.length ? (
            <Button onClick={() => setPairing(true)}>
              <Icon name="plus" />
              Pair a device
            </Button>
          ) : undefined
        }
      />
      <p className="max-w-prose text-sm text-muted">
        Phones, tablets and other browsers that chat with this gateway. Each has its own chat loop
        under Loops → System loops. Revoking a device keeps its loop and history.
      </p>
      {error ? (
        <Alert title="Devices could not be loaded">
          {error}
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Retry now
          </Button>
        </Alert>
      ) : null}
      {!devices && !error ? <p role="status">Loading devices…</p> : null}
      {sorted?.length === 0 ? (
        <Card>
          <div className="grid justify-items-center gap-3 py-6 text-center">
            <GoblinMark className="size-12" />
            <h2 className="text-lg font-semibold">No devices yet</h2>
            <p className="max-w-prose text-sm text-muted">
              Pair a phone or tablet to chat with this gateway from another device.
            </p>
            <Button onClick={() => setPairing(true)}>Pair a device</Button>
          </div>
        </Card>
      ) : sorted?.length ? (
        <Card flush>
          <Table stack="md">
            <thead>
              <tr>
                <Th>Device</Th>
                <Th>Status</Th>
                <Th>Chat loop</Th>
                <Th>Last seen</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((device) => (
                <tr id={`device-${device.id}`} key={device.id}>
                  <Td>
                    <p className="font-semibold wrap-anywhere">{device.label}</p>
                    <p className="text-xs text-subtle">
                      {device.revokedAt ? 'Revoked' : 'Paired'}{' '}
                      {formatDateTime(device.revokedAt ?? device.createdAt)}
                    </p>
                  </Td>
                  <Td label="Status">
                    <Badge tone={device.revokedAt ? 'neutral' : 'good'}>
                      <Icon name={device.revokedAt ? 'cancelled' : 'check-circle'} />
                      {device.revokedAt ? 'Revoked' : 'Active'}
                    </Badge>
                  </Td>
                  <Td label="Chat loop">
                    <Link to={`/loops/${device.loopId}/edit`}>Open chat loop</Link>
                  </Td>
                  <Td label="Last seen">
                    {device.lastSeenAt ? (
                      <time dateTime={device.lastSeenAt}>{formatDateTime(device.lastSeenAt)}</time>
                    ) : (
                      'Not seen since pairing'
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {device.revokedAt ? (
                        <span className="text-sm text-muted">
                          Access revoked · loop and history retained
                        </span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Rename ${device.label}`}
                            onClick={() => setRenaming(device)}
                          >
                            Rename
                          </Button>
                          <ConfirmAction
                            action="revoke"
                            name={device.label}
                            returnFocusTo="devices-heading"
                            consequences={
                              <p>
                                {device.label} loses access to this gateway. Its chat loop,
                                conversation history and runs stay. Requests it already sent may
                                keep running; cancel those in Runs if needed.
                              </p>
                            }
                            onConfirm={() => client.revokeDevice(device.id)}
                            onConfirmed={load}
                          />
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
      {pairing ? (
        <PairDialog
          client={client}
          onClose={() => {
            setPairing(false);
            void load();
          }}
        />
      ) : null}
      {renaming ? (
        <RenameDialog
          client={client}
          device={renaming}
          onClose={() => setRenaming(undefined)}
          onSaved={load}
        />
      ) : null}
    </Page>
  );
}
