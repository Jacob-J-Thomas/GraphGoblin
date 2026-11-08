import { useEffect, useState } from 'react';
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
import { claimDevice, gatewayDestination, PairingError } from './connection.js';
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
  const [rejectedCode, setRejectedCode] = useState(false);
  const [error, setError] = useState('');
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
    if (!rejectedCode || busy) return;
    const field = document.getElementById(linkCode ? 'goblin-paste-code' : 'goblin-pairing-code');
    field?.focus();
    if (field instanceof HTMLTextAreaElement) field.select();
  }, [rejectedCode, busy, linkCode]);

  useEffect(() => {
    if (browserPairing && initialCode && !standalone)
      document.getElementById('goblin-device-label')?.focus();
  }, [browserPairing, initialCode, standalone]);

  async function pair() {
    if (busy || !online) return;
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
    setBusy(true);
    setRejectedCode(false);
    setError('');
    try {
      const enrollment = saved ?? beginPairing(code, label);
      setSaved(enrollment);
      onPaired(await claimDevice(enrollment));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pairing could not finish. Try again.');
      if (cause instanceof PairingError && cause.status === 401) setRejectedCode(true);
    } finally {
      setBusy(false);
    }
  }

  function newCode() {
    try {
      forgetDevice();
      setSaved(undefined);
      setCode('');
      setLinkCode(false);
      setEditingCode((count) => count + 1);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
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
            void pair();
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
                    void pair();
                  }
                }}
              />
              <HelpText id="goblin-pairing-help">Paste the whole code. Case matters.</HelpText>
            </FieldGroup>
          )}
          {saved ? (
            <p className="text-sm text-muted">
              A pairing attempt is saved on this device. Retry checks the same connection.
            </p>
          ) : null}
          {!online ? (
            <p role="status" className="text-sm text-status-warn-fg">
              You’re offline. Reconnect, then tap Pair.
            </p>
          ) : null}
          <Button type="submit" className="h-11 w-full" disabled={busy || !online} aria-busy={busy}>
            {busy
              ? 'Pairing…'
              : saved
                ? 'Retry pairing'
                : !standalone
                  ? 'Pair this browser'
                  : 'Pair'}
          </Button>
          {error ? (
            <div id="goblin-pairing-error">
              <Alert tone="bad" title="Pairing needs attention">
                {error}
              </Alert>
            </div>
          ) : null}
          {saved ? (
            <Button variant="ghost" disabled={busy} onClick={newCode}>
              Use a new code
            </Button>
          ) : null}
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
