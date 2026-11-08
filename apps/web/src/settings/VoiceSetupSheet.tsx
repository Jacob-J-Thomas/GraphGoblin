import { GraphGoblinApiError, secrets } from '@graphgoblin/api-client';
import type { VoiceProbe, VoiceSetup } from '@graphgoblin/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApi } from '../api/context.js';
import {
  Button,
  CHECKBOX_LABEL,
  Checkbox,
  Dialog,
  Disclosure,
  FieldGroup,
  HelpText,
  Input,
  Label,
  Select,
} from '../components/ui/index.js';
import {
  voiceErrorMessage,
  voiceErrorNeedsEditor,
  voiceLoopsKey,
  voiceSetup,
  voiceSetupKey,
  type VoiceConfigUpdate,
  type VoiceLoopPreview,
  type VoicePreview,
} from './voice-client.js';
import {
  clearVoiceOperation,
  readVoiceOperation,
  rememberVoiceOperation,
  type PendingVoiceOperation,
} from './voice-operation.js';

export interface VoiceSetupSheetProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

/** A saved connection and a sample test do not establish a published loop's capability. */
export function VoiceSetupSheet({ open, onClose, onSaved }: VoiceSetupSheetProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Set up voice"
      description="Choose where this gateway transcribes audio, test it, then review each loop."
      closeOnBackdrop={false}
    >
      {open ? <VoiceSetupFlow onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function currentProbe(view: VoiceSetup, route: 'local' | 'cloud') {
  return view.probes.find(
    (probe) => probe.route === route && probe.configRevision === view.config.revision,
  );
}

function measuredReason(probe: VoiceProbe) {
  return `Sample check: ${(probe.latencyMs / 1000).toFixed(1)} s; OS-reported free memory: ${(probe.freeMemoryBytes / 1024 ** 3).toFixed(1)} GiB.`;
}

const LOCAL_SAMPLE_FAILED =
  'The sample was too slow or speech was not recognized here. Choose Cloud provider or test again.';

function VoiceSetupFlow({ onSaved }: { onSaved?: (() => void) | undefined }) {
  const client = useApi();
  const query = useQuery({
    queryKey: voiceSetupKey,
    queryFn: ({ signal }) => voiceSetup.get(client, signal),
    refetchInterval: (state) => (state.state.data?.install.state === 'installing' ? 1000 : false),
  });
  if (!query.data)
    return query.isError ? (
      <div className="grid gap-3">
        <HelpText role="alert" tone="bad">
          {voiceErrorMessage(query.error)}
        </HelpText>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Check setup again
        </Button>
      </div>
    ) : (
      <p role="status" className="text-sm text-muted">
        Checking this gateway…
      </p>
    );
  return <SetupSteps view={query.data} onSaved={onSaved} onRefresh={() => void query.refetch()} />;
}

function SetupSteps({
  view,
  onSaved,
  onRefresh,
}: {
  view: VoiceSetup;
  onSaved?: (() => void) | undefined;
  onRefresh: () => void;
}) {
  const client = useApi();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'route' | 'test' | 'review'>('route');
  const [route, setRoute] = useState<'local' | 'cloud'>(
    view.route.route ?? (view.config.mode === 'cloud' ? 'cloud' : 'local'),
  );
  const [cloudKey, setCloudKey] = useState('');
  const [reuseSecret, setReuseSecret] = useState(false);
  const [secretName, setSecretName] = useState('');
  const [cloudAcknowledged, setCloudAcknowledged] = useState(false);
  const [fallback, setFallback] = useState(view.config.cloudFallbackAllowed);
  const [problem, setProblem] = useState('');
  const [edited, setEdited] = useState(false);
  const [localAttemptRevision, setLocalAttemptRevision] = useState<number>();
  const [pendingOperation, setPendingOperation] = useState<PendingVoiceOperation | undefined>(
    readVoiceOperation,
  );
  const completedOperationRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const compatibleSecrets = view.secrets.filter((secret) => secret.compatible);
  const localProbe = currentProbe(view, 'local');
  const installBusy = view.install.state === 'installing';
  const notify = () => {
    if (onSaved) onSaved();
    else window.dispatchEvent(new Event('graphgoblin:chat-readiness-changed'));
  };
  const saveView = (next: VoiceSetup) => queryClient.setQueryData(voiceSetupKey, next);
  const remember = (
    kind: PendingVoiceOperation['kind'],
    probeRoute?: 'local' | 'cloud',
    configRevision?: number,
  ) => {
    const operation = {
      kind,
      operationId: crypto.randomUUID(),
      ...(probeRoute ? { probeRoute } : {}),
      ...(configRevision !== undefined ? { configRevision } : {}),
    };
    rememberVoiceOperation(operation);
    setPendingOperation(operation);
    return operation;
  };
  const install = useMutation({
    mutationFn: () =>
      voiceSetup.install(client, {
        operationId: remember('install').operationId,
        expectedConfigRevision: view.config.revision,
        modelId: 'tiny.en',
      }),
    onSuccess: () => setProblem(''),
    onError: (error) => setProblem(voiceErrorMessage(error)),
    onSettled: () => {
      busyRef.current = false;
    },
  });
  const test = useMutation({
    mutationFn: async () => {
      if (route === 'cloud' && !cloudAcknowledged) throw new Error('Cloud sample not acknowledged');
      let chosenSecret = reuseSecret ? secretName : '';
      if (route === 'cloud' && !reuseSecret) {
        chosenSecret = `voice.openai.${crypto.randomUUID()}`;
        const value = cloudKey.trim();
        setCloudKey('');
        await secrets.set(client, chosenSecret, value);
        setSecretName(chosenSecret);
        setReuseSecret(true);
      }
      const local =
        view.local.executable && view.local.modelPath
          ? { executable: view.local.executable, modelPath: view.local.modelPath }
          : view.config.local;
      const update: VoiceConfigUpdate = {
        expectedRevision: view.config.revision,
        enabled: true,
        mode: route === 'local' && fallback && view.config.cloud ? 'auto' : route,
        cloudFallbackAllowed: route === 'local' && fallback && Boolean(view.config.cloud),
        ...(local ? { local } : {}),
        ...(route === 'cloud'
          ? { cloud: { provider: 'openai', model: 'gpt-transcribe', secretName: chosenSecret } }
          : view.config.cloud
            ? { cloud: view.config.cloud }
            : {}),
      };
      const saved = await voiceSetup.configure(client, update);
      saveView(saved);
      notify();
      if (route === 'local') setLocalAttemptRevision(saved.config.revision);
      return voiceSetup.probe(client, {
        operationId: remember('probe', route, saved.config.revision).operationId,
        route,
        expectedConfigRevision: saved.config.revision,
        ...(route === 'cloud' ? { cloudUploadAcknowledged: true } : {}),
      });
    },
    onSuccess: () => setProblem(''),
    onError: (error) => {
      setProblem(voiceErrorMessage(error));
      onRefresh();
    },
    onSettled: () => {
      busyRef.current = false;
    },
  });
  const fallbackTest = useMutation({
    mutationFn: () =>
      voiceSetup.probe(client, {
        operationId: remember('probe', 'cloud', view.config.revision).operationId,
        route: 'cloud',
        expectedConfigRevision: view.config.revision,
        cloudUploadAcknowledged: true,
      }),
    onSuccess: () => setProblem(''),
    onError: (error) => setProblem(voiceErrorMessage(error)),
    onSettled: () => {
      busyRef.current = false;
    },
  });
  const operation = useQuery({
    queryKey: ['voice-operation', pendingOperation?.kind, pendingOperation?.operationId],
    queryFn: async ({ signal }) => {
      const result = await voiceSetup.operation(
        client,
        pendingOperation!.kind,
        pendingOperation!.operationId,
        signal,
      );
      setProblem('');
      if (result.state !== 'running' && completedOperationRef.current !== result.operationId) {
        clearVoiceOperation(result.operationId);
        completedOperationRef.current = result.operationId;
        await queryClient.invalidateQueries({ queryKey: voiceSetupKey });
        notify();
      }
      return result;
    },
    enabled:
      Boolean(pendingOperation) && !test.isPending && !install.isPending && !fallbackTest.isPending,
    retry: false,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 1000 : false),
  });
  const operationPending =
    Boolean(pendingOperation) && (!operation.data || operation.data.state === 'running');
  const authoritativeRoute = view.route.ready ? view.route.route : undefined;
  const tested =
    test.isPending || edited
      ? undefined
      : (operation.data?.probe ??
        (authoritativeRoute === route ? currentProbe(view, route) : undefined));
  const passed =
    authoritativeRoute === route &&
    tested?.configRevision === view.config.revision &&
    tested.suitable;
  const autoFallback = route === 'local' && fallback && Boolean(view.config.cloud);
  const savedAutoFallback =
    autoFallback && view.config.mode === 'auto' && view.config.cloudFallbackAllowed && !edited;
  const localResult = currentProbe(view, 'local');
  const cloudResult = currentProbe(view, 'cloud');
  const failedProbeRoute =
    operation.data?.state === 'failed' && pendingOperation?.configRevision === view.config.revision
      ? pendingOperation.probeRoute
      : undefined;
  const localChecked =
    Boolean(localResult) ||
    localAttemptRevision === view.config.revision ||
    failedProbeRoute === 'local';
  const cloudChecked = Boolean(cloudResult) || failedProbeRoute === 'cloud';
  const canReview = savedAutoFallback
    ? Boolean(authoritativeRoute) &&
      localChecked &&
      cloudChecked &&
      Boolean(localResult?.suitable || cloudResult?.suitable)
    : passed;
  const operationProblem =
    operation.data?.state === 'failed' && !test.isPending
      ? voiceErrorMessage(
          new GraphGoblinApiError({
            status: 503,
            code: operation.data.code ?? 'VOICE_TEST_FAILED',
          }),
        )
      : '';
  const displayedProblem = problem || operationProblem;
  const busy =
    test.isPending ||
    install.isPending ||
    installBusy ||
    fallbackTest.isPending ||
    operationPending;
  const operationStarting = test.isPending || install.isPending || fallbackTest.isPending;
  const operationRecovering = !operationStarting && (operation.isError || Boolean(problem));
  const canTest =
    !busy &&
    (route === 'local'
      ? (view.local.available || autoFallback) && (!autoFallback || cloudAcknowledged)
      : cloudAcknowledged &&
        (reuseSecret
          ? compatibleSecrets.some((secret) => secret.name === secretName)
          : Boolean(cloudKey.trim())));
  const cloudRecommended = localProbe && !localProbe.suitable;
  return (
    <div className="grid gap-5">
      {pendingOperation && operationPending ? (
        <div
          role="status"
          className="grid gap-2 rounded-md border border-default bg-surface-sunken p-3"
        >
          <p className="text-sm">
            {operationStarting
              ? pendingOperation.kind === 'probe'
                ? 'Starting sample check…'
                : 'Starting local installation…'
              : operation.data?.state === 'running'
                ? pendingOperation.kind === 'probe'
                  ? 'Testing the sample…'
                  : 'Installing local voice…'
                : operationRecovering
                  ? 'Checking what happened…'
                  : 'Checking operation status…'}
          </p>
          {operation.data?.install ? (
            <progress
              aria-label="Local voice download"
              className="w-full"
              value={operation.data.install.downloadedBytes}
              max={Math.max(view.local.downloadBytes, operation.data.install.downloadedBytes, 1)}
            />
          ) : null}
          <HelpText>
            {operationStarting
              ? 'The gateway is starting this operation. You can close this sheet and return.'
              : 'Progress uses read-only checks without starting the operation again. You can close this sheet and return.'}
          </HelpText>
          {operation.isError ? (
            <Button
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={() => void operation.refetch()}
            >
              Check what happened
            </Button>
          ) : null}
          {operation.error instanceof GraphGoblinApiError && operation.error.status === 404 ? (
            <Button
              size="sm"
              variant="ghost"
              className="justify-self-start"
              onClick={() => {
                clearVoiceOperation(pendingOperation.operationId);
                setPendingOperation(undefined);
                setProblem('No operation was found on this gateway. You can start a new check.');
              }}
            >
              Start a new check
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted" aria-live="polite">
        {step === 'route'
          ? '1. Choose a route'
          : step === 'test'
            ? '2. Connect and test'
            : '3. Review loops'}
      </p>
      {step === 'route' ? (
        <>
          <fieldset className="grid gap-3">
            <legend className="mb-3 text-sm font-semibold">
              Where should voice be transcribed?
            </legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-default p-4">
              <input
                type="radio"
                name="voice-route"
                value="local"
                checked={route === 'local'}
                onChange={() => setRoute('local')}
                className="mt-1"
              />
              <span className="grid gap-1">
                <span className="text-sm font-semibold">
                  On this gateway
                  {localProbe?.suitable && view.route.ready && view.route.route === 'local'
                    ? ' (recommended)'
                    : ''}
                </span>
                <span className="text-sm text-muted">
                  {localProbe
                    ? localProbe.suitable
                      ? measuredReason(localProbe)
                      : LOCAL_SAMPLE_FAILED
                    : 'Audio stays on this gateway. A short check measures transcription speed and records OS-reported free memory.'}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-default p-4">
              <input
                type="radio"
                name="voice-route"
                value="cloud"
                checked={route === 'cloud'}
                onChange={() => setRoute('cloud')}
                className="mt-1"
              />
              <span className="grid gap-1">
                <span className="text-sm font-semibold">
                  Cloud provider{cloudRecommended ? ' (recommended)' : ''}
                </span>
                <span className="text-sm text-muted">
                  {cloudRecommended
                    ? 'The local sample was too slow or speech was not recognized. '
                    : ''}
                  OpenAI transcribes uploaded audio and bills your provider account.
                </span>
              </span>
            </label>
          </fieldset>
          <Button
            className="justify-self-start"
            onClick={() => {
              setStep('test');
              setProblem('');
            }}
          >
            Continue
          </Button>
        </>
      ) : step === 'test' ? (
        <>
          {route === 'local' ? (
            <div className="grid gap-3">
              <h3 className="text-base font-semibold">On this gateway</h3>
              <p className="text-sm text-muted">
                The sample check measures local transcription on this gateway. It does not run your
                chat loop or its actions.
              </p>
              {!view.local.available ? (
                <>
                  <p className="text-sm">
                    {view.local.installSupported
                      ? `Install the small local voice model (${(view.local.downloadBytes / 1024 ** 2).toFixed(0)} MiB download). The verified voice engine is already available.`
                      : 'This gateway cannot install the local voice engine automatically. Choose Cloud provider to continue.'}
                  </p>
                  {view.local.installSupported ? (
                    <Button
                      variant="outline"
                      className="justify-self-start"
                      disabled={busy}
                      onClick={() => {
                        if (busyRef.current || busy) return;
                        busyRef.current = true;
                        install.mutate();
                      }}
                    >
                      Install local voice
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-sm">
                  Local engine and model found. Run the sample to measure this configuration.
                </p>
              )}
              {installBusy && !pendingOperation ? (
                <div role="status" className="grid gap-2">
                  <p className="text-sm">
                    Installing local voice… {(view.install.downloadedBytes / 1024 ** 2).toFixed(0)}{' '}
                    MiB downloaded
                  </p>
                  <progress
                    aria-label="Local voice download"
                    className="w-full"
                    value={view.install.downloadedBytes}
                    max={Math.max(view.local.downloadBytes, view.install.downloadedBytes, 1)}
                  />
                  <HelpText>You can close this sheet while installation continues.</HelpText>
                </div>
              ) : view.install.state === 'failed' ? (
                <HelpText role="alert" tone="bad">
                  Local installation didn’t finish. Try Install local voice again or choose Cloud
                  provider.
                </HelpText>
              ) : null}
              {view.config.cloud ? (
                <label className={CHECKBOX_LABEL}>
                  <Checkbox
                    checked={fallback}
                    disabled={busy}
                    onChange={(event) => {
                      setFallback(event.target.checked);
                      setEdited(true);
                    }}
                  />
                  <span className="text-sm">
                    Allow the configured OpenAI route when local voice is unavailable
                  </span>
                </label>
              ) : (
                <HelpText>
                  To allow cloud fallback,{' '}
                  <button
                    type="button"
                    disabled={busy}
                    className="underline underline-offset-2 disabled:opacity-45"
                    onClick={() => {
                      setRoute('cloud');
                      setEdited(true);
                      setProblem('');
                    }}
                  >
                    set up OpenAI first
                  </button>
                  , then return here to allow it.
                </HelpText>
              )}
              <HelpText>
                {fallback && view.config.cloud
                  ? 'Local is preferred when suitable. Permitted cloud fallback uploads audio to OpenAI and uses your provider account. A request’s route is pinned before transcription; failures never silently switch provider.'
                  : 'Audio stays on this gateway. Automatic cloud fallback is off.'}
              </HelpText>
              {autoFallback ? (
                <label className={CHECKBOX_LABEL}>
                  <Checkbox
                    checked={cloudAcknowledged}
                    disabled={busy}
                    onChange={(event) => setCloudAcknowledged(event.target.checked)}
                  />
                  <span className="text-sm">
                    Upload the included non-private test sample to OpenAI when I test cloud
                    fallback. Provider charges may apply.
                  </span>
                </label>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4">
              <h3 className="text-base font-semibold">Connect OpenAI</h3>
              <p className="text-sm text-muted">
                The gateway keeps the key encrypted. Paired devices never receive it. Inference
                credentials are not selected for voice.
              </p>
              {compatibleSecrets.length ? (
                <>
                  <label className={CHECKBOX_LABEL}>
                    <Checkbox
                      checked={reuseSecret}
                      disabled={busy}
                      onChange={(event) => {
                        setReuseSecret(event.target.checked);
                        setSecretName(event.target.checked ? compatibleSecrets[0]!.name : '');
                        setEdited(true);
                      }}
                    />
                    <span className="text-sm">
                      Use an OpenAI key saved on the gateway for transcription
                    </span>
                  </label>
                  {reuseSecret ? (
                    <FieldGroup>
                      <Label htmlFor="voice-saved-key">Saved transcription key</Label>
                      <Select
                        id="voice-saved-key"
                        value={secretName}
                        disabled={busy}
                        onChange={(event) => {
                          setSecretName(event.target.value);
                          setEdited(true);
                        }}
                      >
                        {compatibleSecrets.map((secret) => (
                          <option key={secret.name} value={secret.name}>
                            {secret.name}
                          </option>
                        ))}
                      </Select>
                    </FieldGroup>
                  ) : null}
                </>
              ) : null}
              {!reuseSecret ? (
                <FieldGroup>
                  <Label htmlFor="voice-provider-key">OpenAI API key</Label>
                  <Input
                    id="voice-provider-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="off"
                    value={cloudKey}
                    disabled={busy}
                    onChange={(event) => {
                      setCloudKey(event.target.value);
                      setEdited(true);
                    }}
                  />
                  <HelpText>The key is saved only when you choose Save and test.</HelpText>
                </FieldGroup>
              ) : null}
              <HelpText>
                OpenAI receives each audio clip sent through this route and bills your OpenAI
                account. Automatic fallback is off. The selected route is available in Voice
                settings before you send.
              </HelpText>
              <p className="text-xs text-muted">
                <a
                  href="https://developers.openai.com/api/docs/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  OpenAI pricing
                </a>
                {' · '}
                <a
                  href="https://developers.openai.com/api/docs/guides/your-data"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  Audio data and retention policy
                </a>
              </p>
              <label className={CHECKBOX_LABEL}>
                <Checkbox
                  checked={cloudAcknowledged}
                  disabled={busy}
                  onChange={(event) => setCloudAcknowledged(event.target.checked)}
                />
                <span className="text-sm">
                  Upload the included non-private test sample to OpenAI. Provider charges may apply.
                </span>
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canTest}
              aria-busy={test.isPending}
              onClick={() => {
                if (busyRef.current || !canTest) return;
                busyRef.current = true;
                setProblem('');
                setEdited(false);
                test.mutate();
              }}
            >
              {test.isPending ? 'Testing sample…' : 'Save and test'}
            </Button>
            <Button
              variant="ghost"
              disabled={test.isPending}
              onClick={() => {
                setStep('route');
                setEdited(true);
                setProblem('');
              }}
            >
              Choose another route
            </Button>
          </div>
          {savedAutoFallback && localChecked ? (
            <div
              role="status"
              className="grid gap-2 rounded-md border border-default bg-surface-sunken p-4"
            >
              <p className="text-sm font-semibold">Automatic route sample checks</p>
              <p className="text-sm">
                On this gateway:{' '}
                {authoritativeRoute === 'local' && localResult?.suitable
                  ? 'sample passed'
                  : localResult?.suitable
                    ? view.route.ready
                      ? 'previous sample succeeded; current route is OpenAI'
                      : 'a fresh check is needed'
                    : 'not qualified for this configuration'}
                .
              </p>
              {localResult ? <HelpText>{measuredReason(localResult)}</HelpText> : null}
              <p className="text-sm">
                OpenAI fallback:{' '}
                {cloudResult?.suitable
                  ? authoritativeRoute === 'cloud'
                    ? 'sample passed'
                    : view.route.ready
                      ? 'previous sample succeeded; qualification is checked before use'
                      : 'a fresh check is needed'
                  : cloudChecked
                    ? 'did not pass this check'
                    : 'sample check still needed'}
                .
              </p>
              {cloudResult?.transcript ? (
                <p className="text-sm">
                  <span className="font-semibold">Cloud sample transcript: </span>
                  {cloudResult.transcript}
                </p>
              ) : null}
              <HelpText>
                {!view.route.ready
                  ? 'No transcription route is currently qualified. Test again to refresh this configuration before reviewing loops.'
                  : authoritativeRoute === 'cloud'
                    ? 'The gateway currently selected OpenAI while fallback is allowed. Local qualification is checked again before use.'
                    : cloudResult?.suitable
                      ? 'Local is the current route. Cloud fallback is allowed by your policy and its qualification is checked before use.'
                      : 'Cloud fallback is allowed by your policy but cannot be used until it passes its check.'}
              </HelpText>
            </div>
          ) : tested ? (
            <div
              role="status"
              className="grid gap-2 rounded-md border border-default bg-surface-sunken p-4"
            >
              <p className="text-sm font-semibold">
                {passed
                  ? 'Sample test passed'
                  : tested.suitable
                    ? 'A fresh sample check is needed'
                    : 'This configuration did not pass the sample check'}
              </p>
              <p className="text-sm text-muted">{measuredReason(tested)}</p>
              {tested.transcript ? (
                <p className="text-sm">
                  <span className="font-semibold">Sample transcript: </span>
                  {tested.transcript}
                </p>
              ) : null}
              <HelpText>
                {passed
                  ? 'Connection saved and sample transcribed. Review and publish the voice step in each loop before using it in Chat.'
                  : tested.suitable
                    ? 'The previous sample result no longer confirms a current route. Test again before reviewing loops.'
                    : route === 'local'
                      ? `${LOCAL_SAMPLE_FAILED} Your loops have not changed.`
                      : 'The cloud sample did not pass. Check the OpenAI connection and billing, then test again. Your loops have not changed.'}
              </HelpText>
            </div>
          ) : view.config.enabled && !test.isPending ? (
            <HelpText>
              Saved settings alone do not confirm a successful sample test or published voice
              capability.
            </HelpText>
          ) : null}
          {savedAutoFallback && localChecked ? (
            <Button
              variant="outline"
              className="justify-self-start"
              disabled={busy || !cloudAcknowledged}
              onClick={() => {
                if (busyRef.current || busy || !cloudAcknowledged) return;
                busyRef.current = true;
                setProblem('');
                fallbackTest.mutate();
              }}
            >
              {fallbackTest.isPending
                ? 'Starting cloud sample…'
                : cloudChecked
                  ? 'Retest cloud fallback'
                  : 'Test cloud fallback'}
            </Button>
          ) : null}
          {canReview ? (
            <Button className="justify-self-start" onClick={() => setStep('review')}>
              Review loops
            </Button>
          ) : null}
        </>
      ) : (
        <LoopReview view={view} onSaved={notify} />
      )}
      {displayedProblem ? (
        <HelpText role="alert" tone="bad">
          {displayedProblem}
        </HelpText>
      ) : null}
      {displayedProblem ? (
        <Button
          variant="outline"
          className="justify-self-start"
          onClick={() => {
            setProblem('');
            onRefresh();
          }}
        >
          Check setup again
        </Button>
      ) : null}
    </div>
  );
}

function LoopReview({ view, onSaved }: { view: VoiceSetup; onSaved: () => void }) {
  const client = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [previews, setPreviews] = useState<VoicePreview[]>([]);
  const [staged, setStaged] = useState<string[]>([]);
  const [editorReviewLoop, setEditorReviewLoop] = useState<VoiceLoopPreview>();
  const query = useQuery({
    queryKey: voiceLoopsKey,
    queryFn: ({ signal }) => voiceSetup.loops(client, signal),
  });
  const preview = useMutation({
    mutationFn: async (items: VoiceLoopPreview[]) => {
      const results: VoicePreview[] = [];
      setEditorReviewLoop(undefined);
      for (const item of items) {
        try {
          results.push(
            await voiceSetup.preview(client, {
              loopId: item.loopId,
              expectedDraftHash: item.definitionHash,
              expectedConfigRevision: view.config.revision,
            }),
          );
        } catch (error) {
          if (voiceErrorNeedsEditor(error)) setEditorReviewLoop(item);
          throw error;
        }
      }
      return results;
    },
    onSuccess: setPreviews,
  });
  const customize = useMutation({
    mutationFn: async (item: VoiceLoopPreview) => {
      try {
        return await voiceSetup.preview(client, {
          loopId: item.loopId,
          expectedDraftHash: item.definitionHash,
          expectedConfigRevision: view.config.revision,
        });
      } catch (error) {
        if (error instanceof GraphGoblinApiError && error.code === 'VOICE_CUSTOM_NORMALIZER') {
          void navigate(`/loops/${encodeURIComponent(item.loopId)}/edit`, {
            state: { voiceReview: true },
          });
          return undefined;
        }
        if (voiceErrorNeedsEditor(error)) setEditorReviewLoop(item);
        throw error;
      }
    },
    onSuccess: (result) => {
      if (!result) return;
      void navigate(`/loops/${encodeURIComponent(result.loopId)}/edit`, {
        state: { voicePreview: result },
      });
    },
  });
  const stage = useMutation({
    mutationFn: async () => {
      for (const item of previews.filter((item) => !staged.includes(item.loopId))) {
        try {
          await voiceSetup.stage(client, {
            loopId: item.loopId,
            expectedDraftHash: item.baseHash,
            expectedConfigRevision: item.configRevision,
            expectedPreviewHash: item.previewHash,
          });
        } catch (error) {
          if (voiceErrorNeedsEditor(error))
            setEditorReviewLoop(query.data?.find((loop) => loop.loopId === item.loopId));
          throw error;
        }
        setStaged((current) => [...current, item.loopId]);
      }
    },
    onSuccess: async () => {
      setPreviews([]);
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: voiceLoopsKey });
      onSaved();
    },
  });
  return (
    <div className="grid gap-4">
      <h3 className="text-base font-semibold">Review each loop</h3>
      <p className="text-sm text-muted">
        The gateway and each paired device have separate loops. Stage only the loops you select,
        then review and publish them in the editor.
      </p>
      {query.isPending ? (
        <p role="status" className="text-sm text-muted">
          Checking loops…
        </p>
      ) : query.isError ? (
        <HelpText role="alert" tone="bad">
          {voiceErrorMessage(query.error)}
        </HelpText>
      ) : (
        <ul className="grid gap-3">
          {query.data.map((item) => (
            <li key={item.loopId} className="grid gap-2 rounded-md border border-default p-3">
              <label className={CHECKBOX_LABEL}>
                <Checkbox
                  checked={selected.includes(item.loopId)}
                  disabled={
                    item.classification !== 'standard' || preview.isPending || stage.isPending
                  }
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.loopId]
                        : current.filter((id) => id !== item.loopId),
                    );
                    setPreviews([]);
                  }}
                />
                <span className="text-sm font-semibold">{item.label}</span>
              </label>
              <p className="text-xs text-muted">
                {item.classification === 'current'
                  ? 'Already current'
                  : item.classification === 'customized'
                    ? 'Customized — needs your review'
                    : 'Standard — can update'}
              </p>
              {item.classification === 'current' ? (
                <HelpText>
                  {item.published
                    ? 'Published voice step matches this configuration. Chat still checks its usable capability.'
                    : 'Current draft only. Publish it in the editor before Chat can use voice.'}
                </HelpText>
              ) : null}
              {staged.includes(item.loopId) ? (
                <p role="status" className="text-sm">
                  Draft staged. Review and publish in the editor.
                </p>
              ) : null}
              {item.classification === 'customized' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-self-start"
                  disabled={customize.isPending}
                  onClick={() => customize.mutate(item)}
                >
                  Review voice step in editor
                </Button>
              ) : (
                <Link
                  className="justify-self-start text-sm underline underline-offset-2"
                  to={`/loops/${encodeURIComponent(item.loopId)}/edit`}
                >
                  Open loop editor
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        className="justify-self-start"
        disabled={!selected.length || preview.isPending || stage.isPending}
        onClick={() => {
          stage.reset();
          preview.mutate(
            (query.data ?? []).filter(
              (item) => selected.includes(item.loopId) && item.classification === 'standard',
            ),
          );
        }}
      >
        {preview.isPending ? 'Preparing preview…' : 'Preview selected changes'}
      </Button>
      {previews.length ? (
        <div className="grid gap-3 rounded-md border border-default bg-surface-sunken p-4">
          <p className="text-sm font-semibold">
            Preview {previews.length} loop draft{previews.length === 1 ? '' : 's'}
          </p>
          {previews.map((item) => (
            <Disclosure
              key={item.loopId}
              label={
                query.data?.find((loop) => loop.loopId === item.loopId)?.label ?? 'Loop definition'
              }
            >
              <p className="mb-2 text-sm">{item.message}</p>
              <pre className="max-h-64 overflow-auto text-xs wrap-anywhere">
                {JSON.stringify(item.definition, null, 2)}
              </pre>
            </Disclosure>
          ))}
          <HelpText>
            Staging updates only the selected drafts. Publishing remains an explicit action in each
            loop’s editor.
          </HelpText>
          <Button
            className="justify-self-start"
            disabled={stage.isPending}
            onClick={() => stage.mutate()}
          >
            {stage.isPending ? 'Staging drafts…' : 'Stage selected drafts'}
          </Button>
        </div>
      ) : null}
      {preview.error || stage.error || customize.error ? (
        <HelpText role="alert" tone="bad">
          {voiceErrorMessage(preview.error ?? stage.error ?? customize.error)}
        </HelpText>
      ) : null}
      {editorReviewLoop ? (
        <Link
          className="justify-self-start text-sm underline underline-offset-2"
          to={`/loops/${encodeURIComponent(editorReviewLoop.loopId)}/edit`}
        >
          Review {editorReviewLoop.label} in the editor
        </Link>
      ) : null}
      {query.isError || preview.error || stage.error || customize.error ? (
        <Button
          variant="outline"
          className="justify-self-start"
          onClick={() => {
            setPreviews([]);
            setSelected([]);
            setEditorReviewLoop(undefined);
            preview.reset();
            stage.reset();
            customize.reset();
            void query.refetch();
          }}
        >
          Check loops again
        </Button>
      ) : null}
      <HelpText>
        A sample test confirms the transcription connection. Chat voice becomes usable only after
        the appropriate loop is published and its capability check succeeds.
      </HelpText>
    </div>
  );
}
