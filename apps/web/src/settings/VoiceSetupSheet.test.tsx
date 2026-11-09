import {
  LoopDefinitionSchema,
  type VoiceOperation,
  type VoiceProbe,
  type VoiceSetup,
} from '@graphgoblin/contracts';
import { fakeUlid, minimalLoop } from '@graphgoblin/contracts/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi, problem, TS } from '../__fixtures__/fake-api.js';
import { renderWith } from '../__fixtures__/render.js';
import { VoiceSetupSheet } from './VoiceSetupSheet.js';
import { VoiceSection } from './sections/VoiceSection.js';

const hash = 'a'.repeat(16);
const gateway = fakeUlid('voice-gateway');
const customized = fakeUlid('voice-customized');
const current = fakeUlid('voice-current');
const definition = LoopDefinitionSchema.parse(minimalLoop());
function observedProbe(
  route: VoiceProbe['route'],
  overrides: Partial<VoiceProbe> = {},
): VoiceProbe {
  return {
    route,
    configRevision: 0,
    fingerprint: 'observed-test',
    suitable: true,
    latencyMs: 1500,
    freeMemoryBytes: 32 * 1024 ** 3,
    checkedAt: new Date().toISOString(),
    message: 'Sample transcribed',
    ...overrides,
  };
}
function setup(initial?: Partial<VoiceSetup>, localSuitable = true, cloudSuitable = true) {
  sessionStorage.clear();
  const api = new FakeApi();
  const operations = new Map<string, VoiceOperation>();
  let view: VoiceSetup = {
    config: { revision: 0, enabled: false, mode: 'auto', cloudFallbackAllowed: false },
    route: { ready: false, cloudFallbackAllowed: false, message: 'Not configured' },
    local: {
      available: true,
      installSupported: true,
      downloadBytes: 75_000_000,
      message: 'Local engine found',
      executable: '/verified/whisper-cli',
      modelPath: '/voice/models/tiny.en.bin',
    },
    probes: [],
    secrets: [],
    install: { state: 'idle', phase: 'idle', downloadedBytes: 0 },
    ...initial,
  };
  api.override('GET /chat/voice/config', () => Response.json(view));
  api.override('PUT /chat/voice/config', (call) => {
    const body = call.body as Omit<VoiceSetup['config'], 'revision'> & { expectedRevision: number };
    const { expectedRevision, ...config } = body;
    if (expectedRevision !== view.config.revision) return problem(409, 'VOICE_CONFIG_CHANGED');
    view = {
      ...view,
      config: { ...config, revision: expectedRevision + 1 },
      route: {
        ready: false,
        cloudFallbackAllowed: config.cloudFallbackAllowed,
        message: 'Test the current configuration.',
      },
    };
    return Response.json(view);
  });
  api.override('POST /chat/voice/probe', (call) => {
    const body = call.body as {
      operationId: string;
      route: 'local' | 'cloud';
      expectedConfigRevision: number;
    };
    const result: VoiceProbe = {
      route: body.route,
      configRevision: body.expectedConfigRevision,
      fingerprint: 'verified-test',
      suitable: body.route === 'local' ? localSuitable : cloudSuitable,
      latencyMs: 1500,
      freeMemoryBytes: 4 * 1024 ** 3,
      checkedAt: TS,
      message: 'Sample transcribed',
      transcript: 'The voice connection is working.',
    };
    const probes = [...view.probes.filter((probe) => probe.route !== result.route), result];
    const suitable = (route: VoiceProbe['route']) =>
      probes.some(
        (probe) =>
          probe.route === route && probe.configRevision === view.config.revision && probe.suitable,
      );
    const selectedRoute =
      view.config.mode !== 'cloud' && suitable('local')
        ? 'local'
        : view.config.mode !== 'local' &&
            (view.config.mode === 'cloud' || view.config.cloudFallbackAllowed) &&
            suitable('cloud')
          ? 'cloud'
          : undefined;
    view = {
      ...view,
      probes,
      route: {
        ready: Boolean(selectedRoute),
        ...(selectedRoute ? { route: selectedRoute } : {}),
        cloudFallbackAllowed: view.config.cloudFallbackAllowed,
        message: 'Qualification checked',
      },
    };
    const operation: VoiceOperation = {
      operationId: body.operationId,
      kind: 'probe',
      state: 'succeeded',
      probe: result,
    };
    operations.set(body.operationId, operation);
    return Response.json(operation, { status: 202 });
  });
  api.override('GET /chat/voice/probes/:id', (_call, [id]) =>
    operations.has(id!)
      ? Response.json(operations.get(id!))
      : problem(404, 'VOICE_OPERATION_NOT_FOUND'),
  );
  api.override('GET /chat/voice/installs/:id', (_call, [id]) =>
    operations.has(id!)
      ? Response.json(operations.get(id!))
      : problem(404, 'VOICE_OPERATION_NOT_FOUND'),
  );
  api.override('GET /chat/voice/loops', () =>
    Response.json({
      items: [
        {
          loopId: gateway,
          definitionHash: hash,
          published: true,
          hasNormalizer: false,
          classification: 'standard',
          label: 'Gateway chat',
        },
        {
          loopId: customized,
          definitionHash: hash,
          published: true,
          hasNormalizer: false,
          classification: 'customized',
          label: 'Kitchen device',
        },
        {
          loopId: current,
          definitionHash: hash,
          published: true,
          hasNormalizer: true,
          classification: 'current',
          label: 'Hall device',
        },
      ],
    }),
  );
  api.override('POST /chat/voice/preview', (call) => {
    const body = call.body as { loopId: string; expectedConfigRevision: number };
    return Response.json({
      loopId: body.loopId,
      baseHash: hash,
      configRevision: body.expectedConfigRevision,
      previewHash: 'b'.repeat(16),
      definition,
      message: 'Adds the voice normalizer and preserves the existing prompt.',
    });
  });
  api.override('POST /chat/voice/stage', (call) => {
    const body = call.body as { loopId: string };
    return Response.json({
      loopId: body.loopId,
      draftHash: 'c'.repeat(16),
      editorUrl: `/loops/${body.loopId}/edit`,
    });
  });
  const onSaved = vi.fn();
  const rendered = renderWith(
    <VoiceSetupSheet open onClose={vi.fn()} onSaved={onSaved} />,
    '/',
    api,
  );
  return {
    ...rendered,
    operations,
    onSaved,
    user: userEvent.setup(),
    getView: () => view,
    setView: (next: VoiceSetup) => {
      view = next;
    },
  };
}
async function localTest(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('radio', { name: /On this gateway/ });
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('button', { name: 'Save and test' }));
  await screen.findByText('Sample test passed');
}

describe('owner voice setup', () => {
  it('measures a sample and keeps configuration, testing, staging and publishing separate', async () => {
    const { api, user, onSaved } = setup();
    await localTest(user);
    expect(screen.getByText('The voice connection is working.')).toBeInTheDocument();
    expect(screen.queryByText(/^Ready$/)).not.toBeInTheDocument();
    expect(api.callsTo('POST', '/chat/voice/preview')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Review loops' }));
    await screen.findByText('Standard — can update');
    expect(screen.getByText('Customized — needs your review')).toBeInTheDocument();
    expect(screen.getByText('Already current')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Kitchen device' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Hall device' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Gateway chat' }));
    expect(screen.getByRole('checkbox', { name: 'Gateway chat' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Preview selected changes' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('alert')?.textContent ??
          api.callsTo('POST', '/chat/voice/preview').length,
      ).toBe(1),
    );
    expect(screen.queryByRole('alert')?.textContent).toBeUndefined();
    await screen.findByText('Preview 1 loop draft');
    expect(api.callsTo('POST', '/chat/voice/stage')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Stage selected drafts' }));
    await screen.findByText('Draft staged. Review and publish in the editor.');
    expect(api.callsTo('POST', '/chat/voice/stage')[0]?.body).toEqual({
      loopId: gateway,
      expectedDraftHash: hash,
      expectedConfigRevision: 1,
      expectedPreviewHash: 'b'.repeat(16),
    });
    expect(api.calls.filter((call) => call.path.endsWith('/publish'))).toHaveLength(0);
    expect(onSaved).toHaveBeenCalled();
  });

  it('keeps compatible key reuse explicit and discloses the cloud sample upload', async () => {
    const { api, user } = setup({
      secrets: [
        { name: 'inference.openai', compatible: false },
        { name: 'voice.openai.test', compatible: true },
      ],
    });
    await screen.findByRole('radio', { name: /Cloud provider/ });
    await user.click(screen.getByRole('radio', { name: /Cloud provider/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('OpenAI API key')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Use an OpenAI key/ }));
    expect(screen.queryByRole('option', { name: 'inference.openai' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: /Upload the included non-private test sample/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    await screen.findByText('Sample test passed');
    expect(api.calls.filter((call) => call.path.startsWith('/secrets/'))).toHaveLength(0);
    expect(api.callsTo('POST', '/chat/voice/probe')[0]?.body).toEqual({
      operationId: expect.any(String),
      route: 'cloud',
      expectedConfigRevision: 1,
      cloudUploadAcknowledged: true,
    });
  });

  it('saves a newly entered cloud key through the gateway secret API and clears the field', async () => {
    const { api, user } = setup();
    api.override('PUT /secrets/:name', () => Response.json({ name: 'saved', updatedAt: TS }));
    await screen.findByRole('radio', { name: /Cloud provider/ });
    await user.click(screen.getByRole('radio', { name: /Cloud provider/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByLabelText('OpenAI API key'), 'test-only-key');
    await user.click(screen.getByRole('checkbox', { name: /Upload the included/ }));
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    await screen.findByText('Sample test passed');
    const saved = api.calls.find(
      (call) => call.method === 'PUT' && call.path.startsWith('/secrets/'),
    );
    expect(saved?.path).toMatch(/^\/secrets\/voice\.openai\./);
    expect(saved?.body).toEqual({ value: 'test-only-key' });
    expect(screen.queryByDisplayValue('test-only-key')).not.toBeInTheDocument();
  });

  it('shows actual local download progress and never tests while installation is running', async () => {
    const { api, user, getView, setView, operations } = setup({
      local: {
        available: false,
        installSupported: true,
        downloadBytes: 75_000_000,
        message: 'Install model',
      },
    });
    api.override('POST /chat/voice/install', (call) => {
      const body = call.body as { operationId: string };
      const next = {
        ...getView(),
        install: { state: 'installing' as const, phase: 'download', downloadedBytes: 12_000_000 },
      };
      setView(next);
      const operation: VoiceOperation = {
        operationId: body.operationId,
        kind: 'install',
        state: 'running',
        install: { phase: 'download', downloadedBytes: 12_000_000 },
      };
      operations.set(body.operationId, operation);
      return Response.json(operation, { status: 202 });
    });
    await screen.findByRole('radio', { name: /On this gateway/ });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Install local voice' }));
    expect(
      await screen.findByRole('progressbar', { name: 'Local voice download' }),
    ).toHaveAttribute('value', '12000000');
    expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
    expect(api.callsTo('POST', '/chat/voice/probe')).toHaveLength(0);
  });

  it('recommends cloud only from a measured unsuitable local check', async () => {
    const { user } = setup({
      probes: [
        {
          route: 'local',
          configRevision: 0,
          fingerprint: 'test',
          suitable: false,
          latencyMs: 22000,
          freeMemoryBytes: 500_000,
          checkedAt: TS,
          message: 'Insufficient headroom',
        },
      ],
    });
    expect(
      await screen.findByRole('radio', { name: /Cloud provider \(recommended\)/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByText(/^Ready$/)).not.toBeInTheDocument();
  });

  it('sanitizes runtime errors and recovers with a read-only check', async () => {
    const { api, user } = setup();
    api.override('POST /chat/voice/probe', () =>
      problem(503, 'VOICE_LOCAL_UNAVAILABLE', '/private/owner/path internal stderr'),
    );
    await screen.findByRole('radio', { name: /On this gateway/ });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The local voice engine is unavailable.',
    );
    expect(screen.queryByText(/private\/owner/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check setup again' }));
    await waitFor(() => expect(api.callsTo('GET', '/chat/voice/config').length).toBeGreaterThan(1));
    expect(api.callsTo('POST', '/chat/voice/probe')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Review loops' })).not.toBeInTheDocument();
  });

  it('leaves customized loops unchanged and opens their explicit preview in the editor', async () => {
    const { api, user } = setup();
    await localTest(user);
    await user.click(screen.getByRole('button', { name: 'Review loops' }));
    const review = await screen.findByRole('button', { name: 'Review voice step in editor' });
    await user.click(review);
    await waitFor(() => expect(api.callsTo('POST', '/chat/voice/preview')).toHaveLength(1));
    expect(screen.queryByRole('alert')?.textContent).toBeUndefined();
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/loops/${customized}/edit`),
    );
    expect(api.callsTo('POST', '/chat/voice/stage')).toHaveLength(0);
    expect(api.calls.filter((call) => call.path.endsWith('/publish'))).toHaveLength(0);
  });

  it('checks the same persisted operation after a lost acknowledgement without repeating a cloud test', async () => {
    const { api, user, operations } = setup({
      secrets: [{ name: 'voice.openai.test', compatible: true }],
    });
    let operationId = '';
    api.override('POST /chat/voice/probe', (call) => {
      operationId = (call.body as { operationId: string }).operationId;
      operations.set(operationId, { operationId, kind: 'probe', state: 'running' });
      expect(sessionStorage.getItem('graphgoblin.voice-operation.v1')).toContain(operationId);
      throw new Error('connection lost after admission');
    });
    api.override('GET /chat/voice/probes/:id', () => problem(503, 'OFFLINE'));
    await screen.findByRole('radio', { name: /Cloud provider/ });
    await user.click(screen.getByRole('radio', { name: /Cloud provider/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('checkbox', { name: /Use an OpenAI key/ }));
    await user.click(screen.getByRole('checkbox', { name: /Upload the included/ }));
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    const check = await screen.findByRole('button', { name: 'Check what happened' });
    expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
    api.override('GET /chat/voice/probes/:id', () =>
      Response.json({
        operationId,
        kind: 'probe',
        state: 'failed',
        code: 'VOICE_CLOUD_OUTCOME_UNCERTAIN',
      }),
    );
    await user.click(check);
    expect(await screen.findByText(/OpenAI did not confirm the test outcome/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/chat/voice/probe')).toHaveLength(1);
    expect(sessionStorage.getItem('graphgoblin.voice-operation.v1')).toBeNull();
  });

  it('does not overwrite a loop changed after preview', async () => {
    const { api, user } = setup();
    await localTest(user);
    await user.click(screen.getByRole('button', { name: 'Review loops' }));
    await screen.findByText('Standard — can update');
    await user.click(screen.getByRole('checkbox', { name: 'Gateway chat' }));
    await user.click(screen.getByRole('button', { name: 'Preview selected changes' }));
    await screen.findByText('Preview 1 loop draft');
    api.override('POST /chat/voice/stage', () => problem(409, 'VOICE_DRAFT_STALE'));
    await user.click(screen.getByRole('button', { name: 'Stage selected drafts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('changed. Check again');
    await user.click(screen.getByRole('button', { name: 'Check loops again' }));
    expect(api.callsTo('POST', '/chat/voice/stage')).toHaveLength(1);
    expect(api.calls.filter((call) => call.path.endsWith('/publish'))).toHaveLength(0);
  });

  it('opens a custom normalizer for review when a safe generated preview is refused', async () => {
    const { api, user } = setup();
    await localTest(user);
    await user.click(screen.getByRole('button', { name: 'Review loops' }));
    api.override('POST /chat/voice/preview', () => problem(409, 'VOICE_CUSTOM_NORMALIZER'));
    await user.click(await screen.findByRole('button', { name: 'Review voice step in editor' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/loops/${customized}/edit`),
    );
    expect(api.callsTo('POST', '/chat/voice/stage')).toHaveLength(0);
  });

  it.each([
    [true, true],
    [false, true],
    [true, false],
  ])(
    'checks explicit Auto fallback under one revision (local %s, cloud %s)',
    async (localSuitable, cloudSuitable) => {
      const { api, user } = setup(
        {
          config: {
            revision: 0,
            enabled: false,
            mode: 'auto',
            cloudFallbackAllowed: false,
            cloud: { provider: 'openai', model: 'gpt-transcribe', secretName: 'voice.openai.test' },
          },
        },
        localSuitable,
        cloudSuitable,
      );
      await screen.findByRole('radio', { name: /On this gateway/ });
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.click(screen.getByRole('checkbox', { name: /Allow the configured OpenAI route/ }));
      expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
      await user.click(screen.getByRole('checkbox', { name: /when I test cloud fallback/ }));
      await user.click(screen.getByRole('button', { name: 'Save and test' }));
      const fallbackTest = await screen.findByRole('button', { name: 'Test cloud fallback' });
      await waitFor(() => expect(fallbackTest).toBeEnabled());
      expect(screen.queryByRole('button', { name: 'Review loops' })).not.toBeInTheDocument();
      await user.click(fallbackTest);
      await screen.findByText(
        cloudSuitable
          ? localSuitable
            ? 'OpenAI fallback: previous sample succeeded; qualification is checked before use.'
            : 'OpenAI fallback: sample passed.'
          : 'OpenAI fallback: did not pass this check.',
      );
      expect(await screen.findByRole('button', { name: 'Review loops' })).toBeInTheDocument();
      const tests = api
        .callsTo('POST', '/chat/voice/probe')
        .map(
          (call) =>
            call.body as { operationId: string; route: string; expectedConfigRevision: number },
        );
      expect(tests.map((test) => test.route)).toEqual(['local', 'cloud']);
      expect(tests.map((test) => test.expectedConfigRevision)).toEqual([1, 1]);
      expect(new Set(tests.map((test) => test.operationId)).size).toBe(2);
      expect(api.callsTo('PUT', '/chat/voice/config')).toHaveLength(1);
      expect(api.callsTo('PUT', '/chat/voice/config')[0]?.body).toMatchObject({
        mode: 'auto',
        cloudFallbackAllowed: true,
      });
    },
  );

  it('describes an unsuitable sample without inventing a free-memory cause', async () => {
    const { user } = setup(
      {
        probes: [
          observedProbe('local', {
            suitable: false,
            latencyMs: 31000,
            message: 'The sample was too slow or speech was not recognized.',
          }),
        ],
      },
      false,
    );
    await screen.findByRole('radio', { name: /Cloud provider \(recommended\)/ });
    expect(
      screen.getByText(/The sample was too slow or speech was not recognized here/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/headroom|freeing memory|free gateway memory/),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    await screen.findByText('This configuration did not pass the sample check');
    expect(screen.getByText(/OS-reported free memory/)).toBeInTheDocument();
    expect(
      screen.queryByText(/headroom|freeing memory|free gateway memory/),
    ).not.toBeInTheDocument();
  });

  it('offers the loop editor when a safe voice preview cannot be produced', async () => {
    const { api, user } = setup();
    await localTest(user);
    await user.click(screen.getByRole('button', { name: 'Review loops' }));
    await screen.findByText('Standard — can update');
    await user.click(screen.getByRole('checkbox', { name: 'Gateway chat' }));
    api.override('POST /chat/voice/preview', () => problem(409, 'VOICE_PREVIEW_INVALID'));
    await user.click(screen.getByRole('button', { name: 'Preview selected changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot safely edit this loop');
    const editor = screen.getByRole('link', { name: 'Review Gateway chat in the editor' });
    expect(editor).toHaveAttribute('href', `/loops/${gateway}/edit`);
    await user.click(editor);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/loops/${gateway}/edit`),
    );
    expect(api.callsTo('POST', '/chat/voice/preview')).toHaveLength(1);
    expect(api.callsTo('POST', '/chat/voice/stage')).toHaveLength(0);
  });

  it('guides an unsupported raw-input prompt to manual editor review without staging it', async () => {
    const { api, user } = setup();
    await localTest(user);
    await user.click(screen.getByRole('button', { name: 'Review loops' }));
    api.override('POST /chat/voice/preview', () =>
      problem(409, 'VOICE_PRESET_PROMPT_UNSUPPORTED', 'private runtime detail'),
    );
    await user.click(await screen.findByRole('button', { name: 'Review voice step in editor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'raw input can miss voice transcripts',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'make it read normalized text before adding voice',
    );
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    const editor = screen.getByRole('link', { name: 'Review Kitchen device in the editor' });
    expect(editor).toHaveAttribute('href', `/loops/${customized}/edit`);
    await user.click(editor);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/loops/${customized}/edit`),
    );
    expect(api.callsTo('POST', '/chat/voice/preview')).toHaveLength(1);
    expect(api.callsTo('POST', '/chat/voice/stage')).toHaveLength(0);
    expect(api.calls.filter((call) => call.path.endsWith('/publish'))).toHaveLength(0);
    expect(screen.queryByText('private runtime detail')).not.toBeInTheDocument();
  });

  it.each(['expired', 'runtime changed'])(
    'uses server readiness when same-revision sample evidence is %s',
    async (reason) => {
      const checkedAt = new Date(
        Date.now() - (reason === 'expired' ? 8 * 86400_000 : 0),
      ).toISOString();
      const { user } = setup({
        config: {
          revision: 0,
          enabled: true,
          mode: 'auto',
          cloudFallbackAllowed: true,
          cloud: { provider: 'openai', model: 'gpt-transcribe', secretName: 'voice.openai.test' },
        },
        route: {
          ready: false,
          cloudFallbackAllowed: true,
          message: 'A fresh qualification is required.',
        },
        probes: [observedProbe('local', { checkedAt }), observedProbe('cloud', { checkedAt })],
      });
      await screen.findByRole('button', { name: 'Continue' });
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      expect(screen.getByText('On this gateway: a fresh check is needed.')).toBeInTheDocument();
      expect(screen.getByText('OpenAI fallback: a fresh check is needed.')).toBeInTheDocument();
      expect(
        screen.queryByText(/sample passed|previous sample succeeded/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Review loops' })).not.toBeInTheDocument();
    },
  );

  it('keeps old-revision evidence in the fixture without treating it as a current cloud check', async () => {
    const { user, getView } = setup({
      config: {
        revision: 0,
        enabled: false,
        mode: 'auto',
        cloudFallbackAllowed: false,
        cloud: { provider: 'openai', model: 'gpt-transcribe', secretName: 'voice.openai.test' },
      },
      probes: [observedProbe('cloud')],
    });
    await screen.findByRole('button', { name: 'Continue' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('checkbox', { name: /Allow the configured OpenAI route/ }));
    await user.click(screen.getByRole('checkbox', { name: /when I test cloud fallback/ }));
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Test cloud fallback' })).toBeEnabled(),
    );
    expect(getView().probes).toContainEqual(
      expect.objectContaining({ route: 'cloud', configRevision: 0, suitable: true }),
    );
    expect(getView().config.revision).toBe(1);
    expect(screen.getByText('OpenAI fallback: sample check still needed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review loops' })).not.toBeInTheDocument();
  });

  it('distinguishes starting the sample POST from read-only progress and uncertain recovery', async () => {
    const { api, user, operations } = setup();
    let acknowledge: ((response: Response) => void) | undefined;
    let operationId = '';
    const acknowledgement = new Promise<Response>((resolve) => {
      acknowledge = resolve;
    });
    api.override('POST /chat/voice/probe', (call) => {
      operationId = (call.body as { operationId: string }).operationId;
      operations.set(operationId, { operationId, kind: 'probe', state: 'running' });
      return acknowledgement;
    });
    await screen.findByRole('button', { name: 'Continue' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(await screen.findByText('Starting sample check…')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The gateway is starting this operation. You can close this sheet and return.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Checking what happened…')).not.toBeInTheDocument();
    expect(api.callsTo('GET', `/chat/voice/probes/${operationId}`)).toHaveLength(0);
    acknowledge?.(Response.json(operations.get(operationId), { status: 202 }));
    expect(await screen.findByText('Testing the sample…')).toBeInTheDocument();
    expect(screen.queryByText('Checking what happened…')).not.toBeInTheDocument();
    expect(api.callsTo('POST', '/chat/voice/probe')).toHaveLength(1);
  });

  it('guides local setup to the cloud connection before fallback can be allowed', async () => {
    const { api, user } = setup();
    await screen.findByRole('button', { name: 'Continue' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'set up OpenAI first' }));
    expect(screen.getByRole('heading', { name: 'Connect OpenAI' })).toBeInTheDocument();
    expect(api.callsTo('PUT', '/chat/voice/config')).toHaveLength(0);
    expect(api.callsTo('POST', '/chat/voice/probe')).toHaveLength(0);
  });

  it.each(['local', 'cloud'] as const)(
    'does not advertise an unready %s route in Settings',
    async (route) => {
      const { api, unmount } = setup({
        config: { revision: 0, enabled: true, mode: route, cloudFallbackAllowed: false },
        route: { ready: false, route, cloudFallbackAllowed: false, message: 'Retest.' },
      });
      unmount();
      renderWith(<VoiceSection />, '/', api);
      expect(
        await screen.findByText('Voice connection saved. A successful test is still needed.'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Transcription route:/)).not.toBeInTheDocument();
    },
  );
});
