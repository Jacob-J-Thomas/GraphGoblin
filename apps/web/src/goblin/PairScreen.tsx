import { useEffect, useRef, useState } from 'react';
import { ChatPairClaimRequestSchema } from '@graphgoblin/contracts';
import { GoblinMark, Icon } from '../components/icons/index.js';
import {
  Alert,
  Button,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Textarea,
} from '../components/ui/index.js';
import {
  beginPairing,
  forgetDevice,
  type DeviceCredential,
  type PendingPairing,
} from './credentials.js';
import {
  claimDevice,
  gatewayDestination,
  PairingError,
  type PairingOutcome,
} from './connection.js';
import { useStandalone } from './standalone.js';
import { installationGuidance } from './useInstall.js';

export interface PairScreenProps {
  initialCode: string;
  pending?: PendingPairing;
  online: boolean;
  notice?: string;
  onPaired: (device: DeviceCredential) => void;
  navigate?: (url: string) => void;
  install?: (() => Promise<void>) | undefined;
}

export function PairScreen({
  initialCode,
  pending,
  online,
  notice,
  onPaired,
  install,
  navigate = (url) => window.location.assign(url),
}: PairScreenProps) {
  const [code, setCode] = useState(initialCode || pending?.code || '');
  const matchingPending =
    pending && (!initialCode || pending.code === initialCode) ? pending : undefined;
  const [label, setLabel] = useState(matchingPending?.label ?? '');
  const [saved, setSaved] = useState(matchingPending);
  const [linkCode, setLinkCode] = useState(Boolean(initialCode));
  const [editingCode, setEditingCode] = useState(0);
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);
  const [outcome, setOutcome] = useState<PairingOutcome | 'idle'>(
    matchingPending ? 'unconfirmed' : 'idle',
  );
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<'request' | 'specific'>('specific');
  const [errorStatus, setErrorStatus] = useState<number>();
  const [errorFocus, setErrorFocus] = useState(0);
  const [replacementNotice, setReplacementNotice] = useState('');
  const [gateway, setGateway] = useState('');
  const [gatewayError, setGatewayError] = useState('');
  const [installNotice, setInstallNotice] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const standalone = useStandalone();
  const [browserPairing, setBrowserPairing] = useState(
    !initialCode || standalone || Boolean(matchingPending),
  );
  const installFirst = !standalone && linkCode && !browserPairing;
  const focusCode = () =>
    document.getElementById(linkCode ? 'goblin-paste-code' : 'goblin-pairing-code')?.focus();
  useEffect(() => {
    document.getElementById('goblin-pair-heading')?.focus();
  }, []);
  useEffect(() => {
    if (editingCode > 0) document.getElementById('goblin-pairing-code')?.focus();
  }, [editingCode]);
  useEffect(() => {
    if (errorFocus > 0 && !busy) document.getElementById('goblin-pairing-error')?.focus();
  }, [errorFocus, busy]);

  useEffect(() => {
    if (browserPairing && initialCode && !standalone)
      document.getElementById('goblin-device-label')?.focus();
  }, [browserPairing, initialCode, standalone]);

  async function pair() {
    if (inFlightRef.current || busy || !online) return;
    setErrorKind('specific');
    if (!label.trim()) {
      setError('Enter a name for this device.');
      document.getElementById('goblin-device-label')?.focus();
      return;
    }
    if (label.trim().length > 80) {
      setError('Use 80 characters or fewer.');
      document.getElementById('goblin-device-label')?.focus();
      return;
    }
    if (!code.trim()) {
      setError('Paste the pairing code from the gateway.');
      focusCode();
      return;
    }
    if (!ChatPairClaimRequestSchema.shape.code.safeParse(code.trim()).success) {
      setError(
        'That isn’t a whole pairing code. Copy it from the gateway again and paste it here.',
      );
      focusCode();
      return;
    }
    inFlightRef.current = true;
    setBusy(true);
    setError('');
    setErrorStatus(undefined);
    setReplacementNotice('');
    // Keep the actual durable enrollment across the await. React's captured `saved` can
    // still be empty when writing success fails after beginPairing already persisted it.
    let enrollment = saved;
    try {
      enrollment ??= beginPairing(code, label);
      setSaved(enrollment);
      setOutcome('unconfirmed');
      onPaired(await claimDevice(enrollment));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pairing could not finish. Try again.');
      setOutcome(
        enrollment ? (cause instanceof PairingError ? cause.outcome : 'unconfirmed') : 'idle',
      );
      setErrorKind(cause instanceof PairingError ? 'request' : 'specific');
      setErrorStatus(cause instanceof PairingError ? cause.status : undefined);
      setErrorFocus((count) => count + 1);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  function newCode() {
    if (inFlightRef.current || busy) return;
    setReplacementNotice('');
    try {
      forgetDevice();
      setSaved(undefined);
      setCode('');
      setLinkCode(false);
      setEditingCode((count) => count + 1);
      setError('');
      setErrorStatus(undefined);
      setOutcome('idle');
      setReplacementNotice(
        saved ? 'Saved attempt forgotten. Paste a new code.' : 'Paste a new code.',
      );
    } catch (cause) {
      setError((cause as Error).message);
      setErrorKind('specific');
      setErrorStatus(undefined);
      setErrorFocus((count) => count + 1);
    }
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[29rem] flex-col justify-center gap-6 px-page py-8">
      <div className="grid justify-items-center gap-3 text-center">
        <GoblinMark className="size-12" />
        <h1
          id="goblin-pair-heading"
          tabIndex={-1}
          className="text-2xl font-semibold text-heading focus:outline-none"
        >
          {installFirst ? 'Install Goblin, then pair in the app' : 'Pair this device'}
        </h1>
        <p className="text-sm text-muted">
          {installFirst
            ? 'The installed app may keep its storage apart from this browser, so pair inside the app you plan to use. Continue only if you just created this link on the gateway.'
            : linkCode
              ? `You opened a pairing link for ${window.location.host}. Name this device, then tap Pair. Continue only if you just created this link on the gateway.`
              : standalone
                ? 'Paste the pairing code from the gateway, name this device, then tap Pair.'
                : 'On the gateway, open Chat → Devices → Pair a device. Open its link on this device, or paste its code here.'}
        </p>
        <p className="max-w-full font-mono text-xs text-subtle wrap-anywhere">
          {window.location.host}
        </p>
      </div>
      {notice ? (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      ) : null}
      {installFirst ? (
        <section className="grid gap-5 text-sm" aria-label="Install before pairing">
          <div className="grid gap-2">
            <p className="font-medium text-heading">1 · Copy the pairing code</p>
            <Button
              className="h-11 max-sm:w-full"
              onClick={() => {
                const fallback = () => {
                  setManualCopy(true);
                  setInstallNotice('Couldn’t copy. Select the code and copy it yourself.');
                };
                void navigator.clipboard
                  ?.writeText(code)
                  .then(() => setInstallNotice('Code copied.'), fallback);
                if (!navigator.clipboard) fallback();
              }}
            >
              <Icon name="copy" />
              Copy code
            </Button>
            {installNotice ? (
              <p role="status" className="text-xs text-muted">
                {installNotice}
              </p>
            ) : null}
            {manualCopy ? (
              <div className="grid gap-1">
                <p id="goblin-copy-code-label">Pairing code</p>
                <code
                  aria-labelledby="goblin-copy-code-label"
                  className="rounded-md bg-surface-sunken p-3 font-mono text-sm break-all select-all"
                >
                  {code}
                </code>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <p className="font-medium text-heading">2 · Install Goblin</p>
            {install ? (
              <Button
                variant="outline"
                className="h-11 max-sm:w-full"
                onClick={() => {
                  void install().catch(() => setInstallNotice(installationGuidance()));
                }}
              >
                Install Goblin
              </Button>
            ) : (
              <p className="text-xs text-muted">{installationGuidance()}</p>
            )}
          </div>
          <p className="font-medium text-heading">
            3 · Open the installed Goblin app, paste the code and tap Pair.
          </p>
          <p className="text-xs text-muted">This page forgets the code if you reload or leave.</p>
          <div className="border-t border-default pt-5">
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => setBrowserPairing(true)}
            >
              Pair this browser instead
            </Button>
          </div>
        </section>
      ) : !standalone ? (
        <p className="text-sm text-muted">
          On a phone? Install Goblin first and pair inside the app.
        </p>
      ) : null}
      {!installFirst ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (outcome !== 'rejected') void pair();
          }}
        >
          <FieldGroup>
            <Label htmlFor="goblin-device-label" required>
              Device name
            </Label>
            <Input
              id="goblin-device-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Kitchen tablet"
              autoComplete="off"
              readOnly={busy || Boolean(saved)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'goblin-pairing-error' : undefined}
            />
            <HelpText>Shown on the gateway’s Devices page.</HelpText>
          </FieldGroup>
          {linkCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Icon name="check" className="text-status-good-fg" />
              <p>Pairing code: from the link</p>
              <Button
                type="button"
                id="goblin-paste-code"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={newCode}
              >
                Paste a different code
              </Button>
            </div>
          ) : (
            <FieldGroup>
              <Label htmlFor="goblin-pairing-code" required>
                Pairing code
              </Label>
              <Textarea
                id="goblin-pairing-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                rows={2}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={512}
                readOnly={busy || Boolean(saved)}
                aria-invalid={Boolean(error)}
                aria-describedby="goblin-pairing-help goblin-pairing-error"
                className="font-mono text-lg wrap-anywhere"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (outcome !== 'rejected') void pair();
                  }
                }}
              />
              <HelpText id="goblin-pairing-help">Paste the whole code. Case matters.</HelpText>
            </FieldGroup>
          )}
          {saved ? (
            <p className="text-sm text-muted">
              {outcome === 'rejected'
                ? 'The saved attempt is currently refused. Use a new code to replace it.'
                : 'A pairing attempt is saved on this device. Retry pairing reuses the saved request and device credential.'}
            </p>
          ) : null}
          {!online ? (
            <p role="status" className="text-sm text-status-warn-fg">
              {outcome === 'idle'
                ? 'You’re offline. Reconnect to pair.'
                : 'You’re offline. Reconnect to retry pairing.'}
            </p>
          ) : null}
          {error ? (
            <div id="goblin-pairing-error" tabIndex={-1} className="focus:outline-none">
              <Alert
                tone="bad"
                title={
                  errorKind === 'request'
                    ? outcome === 'rejected'
                      ? 'Pairing was refused'
                      : 'Not sure pairing finished'
                    : 'Pairing needs attention'
                }
              >
                {errorKind === 'request' ? (
                  outcome === 'rejected' ? (
                    'The gateway currently refuses this code and the saved credential. Use a new code to replace the saved attempt.'
                  ) : (
                    <div className="grid gap-2">
                      {errorStatus === 429 ? (
                        <p>Too many pairing attempts. Wait about a minute, then retry.</p>
                      ) : null}
                      <p>
                        The gateway didn’t confirm this pairing. Retry pairing reuses the saved
                        request and device credential.
                      </p>
                      {errorStatus !== undefined &&
                      errorStatus >= 400 &&
                      errorStatus < 500 &&
                      errorStatus !== 401 &&
                      errorStatus !== 429 ? (
                        <p>{error}</p>
                      ) : null}
                    </div>
                  )
                ) : (
                  error
                )}
              </Alert>
            </div>
          ) : null}
          {replacementNotice ? (
            <p role="status" className="text-sm text-muted">
              {replacementNotice}
            </p>
          ) : null}
          {outcome === 'rejected' ? (
            <>
              <Button type="button" className="h-11 w-full" disabled={busy} onClick={newCode}>
                Use a new code
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !online}
                aria-busy={busy}
                onClick={() => {
                  void pair();
                }}
              >
                {busy ? 'Pairing…' : 'Retry pairing'}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="submit"
                className="h-11 w-full"
                disabled={busy || !online}
                aria-busy={busy}
              >
                {busy
                  ? 'Pairing…'
                  : outcome === 'unconfirmed'
                    ? 'Retry pairing'
                    : !standalone
                      ? 'Pair this browser'
                      : 'Pair'}
              </Button>
              {saved ? (
                <Button type="button" variant="ghost" disabled={busy} onClick={newCode}>
                  Use a new code
                </Button>
              ) : null}
            </>
          )}
          {!standalone ? (
            <HelpText>Pairs this browser only. The installed app needs its own pairing.</HelpText>
          ) : null}
        </form>
      ) : null}
      <details className="border-t border-default pt-4 text-sm">
        <summary className="cursor-pointer font-medium text-muted">
          Pairing with a different gateway?
        </summary>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setGatewayError('');
            try {
              navigate(gatewayDestination(gateway));
            } catch (cause) {
              setGatewayError((cause as Error).message);
            }
          }}
        >
          <FieldGroup>
            <Label htmlFor="goblin-gateway-address">Gateway address</Label>
            <Input
              id="goblin-gateway-address"
              type="url"
              inputMode="url"
              value={gateway}
              onChange={(event) => setGateway(event.target.value)}
              placeholder="https://goblin.example"
            />
            <HelpText>
              Goblin opens from that address. Use https://, or http:// only for localhost.
            </HelpText>
          </FieldGroup>
          {gatewayError ? (
            <p role="alert" className="text-sm text-status-bad-fg">
              {gatewayError}
            </p>
          ) : null}
          <Button variant="outline" type="submit">
            Open
          </Button>
        </form>
      </details>
    </main>
  );
}
