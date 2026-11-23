import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('./', import.meta.url));
const evidence = 'G:/ggq/delivery-evidence/2026-11-17-five-intents';
const root = 'G:/ggq/gg-i5-offline-ui-qa/GraphGoblin';
const sourcePacket = `${evidence}/i5-d241-observation-entry-loss-corrected-qa-01`;
const fragmentPath = `${evidence}/i5-d241-observation-entry-loss-preparation-02/CASES.tsx.fragment`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, data) => writeFile(join(directory, name), data, { flag: 'wx' });
const replaceOnce = (text, before, after) => {
  if (text.split(before).length !== 2) throw new Error('Exactly one diagnostic insertion site required: ' + before.slice(0, 70));
  return text.replace(before, after);
};
if (process.version !== 'v22.23.4') throw new Error('Project Node22.23.4 required');
const manifestBytes = await readFile(`${sourcePacket}/MANIFEST.json`);
if (sha(manifestBytes) !== '30b81bcb6650719af05444374324d98e472d670c18cd03af5e56fa4935bea00d') throw new Error('Original result seal drift');
const members = JSON.parse(manifestBytes).members;
for (const item of members) {
  const data = await readFile(join(sourcePacket, item.path));
  if (data.length !== item.bytes || sha(data) !== item.sha256) throw new Error('Original result member drift');
}
const base = await readFile(`${sourcePacket}/executed.component.tsx`);
if (sha(base) !== '8a344821db18ec25fa7cf2219c07721acf4eddae0d109b8eb3a412ca58aa6c2b') throw new Error('Exact63 source required');
const originalFragment = await readFile(fragmentPath, 'utf8');
if (!Buffer.concat([base.subarray(0, 60996), Buffer.from('\n'), Buffer.from(originalFragment)]).equals(base)) throw new Error('Exact61/fragment composition required');
await save('base63.component.tsx', base);
let fragment = originalFragment;
fragment = replaceOnce(fragment, "import { API_KEY_STORAGE } from '../api/api-key.js';", "import { API_KEY_STORAGE } from '../api/api-key.js';\nimport { getConfig } from '@testing-library/react';");
const declarations = `      let originalSessionButton: HTMLElement | undefined;
      let originalRunHeader: Element | null = null;
      let diagnosticPhase = 'initial';
      let observer: MutationObserver | undefined;
      let observedBatches = 0;
      let removedOriginalButtonRecords = 0;
      let removedOriginalHeaderRecords = 0;
      const feedbackObservation: {
        immediate?: { text: string; visible: boolean; diagnostic?: string };
        settled?: { text: string; visible: boolean; diagnostic?: string };
        settleOutcome?: string;
        waitStartedMs?: number;
        waitFinishedMs?: number;
      } = {};
      function domSample(stage: string) {
        const current = screen.queryByRole('button', { name: 'Start fresh session for worker' });
        return {
          stage, phase: diagnosticPhase, atMs: performance.now(),
          originalButtonConnected: originalSessionButton?.isConnected ?? null,
          originalHeaderConnected: originalRunHeader?.isConnected ?? null,
          currentButtonPresent: current !== null,
          currentButtonIsOriginal: current && originalSessionButton ? current === originalSessionButton : null,
          currentButtonDisabled: current?.hasAttribute('disabled') ?? null,
          runHeadingPresent: screen.queryByRole('heading', { name: 'Run ' + run.id }) !== null,
          notSentText: screen.queryByText(/^Not sent:/)?.textContent ?? null,
          readingEvidence: screen.queryByText('Reading the run evidence again.', { exact: true }) !== null,
          lastObserved: screen.queryByText(STALE) !== null,
        };
      }
      const domSamples: ReturnType<typeof domSample>[] = [];
      const recordDom = (stage: string) => {
        if (domSamples.length < 64) domSamples.push(domSample(stage));
      };
`;
fragment = replaceOnce(fragment, '      let stopSamples = () => {};\n      try {', '      let stopSamples = () => {};\n' + declarations + '      try {');
const installObserver = `        originalSessionButton = button('Start fresh session for worker');
        originalRunHeader = (await heading(run.id)).closest('header');
        expect(originalRunHeader).not.toBeNull();
        recordDom('original-session-control');
        if (rotateKey) {
          observer = new MutationObserver(records => {
            observedBatches++;
            for (const record of records) for (const node of record.removedNodes) {
              if (node === originalSessionButton || (node instanceof Element && originalSessionButton && node.contains(originalSessionButton))) removedOriginalButtonRecords++;
              if (node === originalRunHeader || (node instanceof Element && originalRunHeader && node.contains(originalRunHeader))) removedOriginalHeaderRecords++;
            }
            recordDom('observed-dom-mutation');
          });
          observer.observe(view.container, { childList: true, subtree: true });
        }
`;
fragment = replaceOnce(fragment, '        const parentQuery = cache.find({ queryKey: runKey, exact: true });', installObserver + '        const parentQuery = cache.find({ queryKey: runKey, exact: true });');
fragment = replaceOnce(fragment, '          api.requiredKey = keyB;\n          act(() => {', "          diagnosticPhase = 'key-rotation';\n          recordDom('before-key-rotation');\n          api.requiredKey = keyB;\n          act(() => {");
fragment = replaceOnce(fragment, "          await waitFor(() => {\n            expect(useApiKeyStore.getState().generation)", "          recordDom('after-storage-event');\n          await waitFor(() => {\n            expect(useApiKeyStore.getState().generation)");
fragment = replaceOnce(fragment, '        view.hold.release();\n        await waitFor(() => expect(oldChoice.state.status)', "        diagnosticPhase = 'old-choice-release';\n        recordDom('before-old-choice-release');\n        view.hold.release();\n        await waitFor(() => expect(oldChoice.state.status)");
const settle = `        feedbackObservation.immediate = { text: oldFeedbackText, visible: oldFeedbackVisible, diagnostic: oldFeedbackDiagnostic };
        diagnosticPhase = 'feedback-settling';
        recordDom('original-immediate-feedback-capture');
        feedbackObservation.waitStartedMs = performance.now();
        try {
          await waitFor(() => {
            const renderedFeedback = screen.queryByText(/^Not sent:/);
            expect(renderedFeedback).toBeVisible();
            feedbackObservation.settled = { text: renderedFeedback?.textContent ?? '', visible: true };
          });
          feedbackObservation.settleOutcome = 'visible-within-existing-default';
        } catch (error) {
          feedbackObservation.settleOutcome = 'not-visible-within-existing-default';
          feedbackObservation.settled = {
            text: screen.queryByText(/^Not sent:/)?.textContent ?? '', visible: false,
            diagnostic: error instanceof Error ? error.message : String(error),
          };
        }
        feedbackObservation.waitFinishedMs = performance.now();
        recordDom('after-default-feedback-wait');
`;
const choiceSite = "        } catch (error) {\n          oldFeedbackDiagnostic = error instanceof Error ? error.message : String(error);\n        }\n        await choose('fresh-session');";
fragment = replaceOnce(fragment, choiceSite, choiceSite.replace("        await choose('fresh-session');", settle + "        await choose('fresh-session');\n        diagnosticPhase = 'fresh-choice';\n        recordDom('after-fresh-choice');"));
const log = `        recordDom('before-test-cleanup');
        observer?.disconnect();
        console.info('B1_FEEDBACK_DIAGNOSTIC ' + JSON.stringify({
          replacement, defaultWaitForMs: getConfig().asyncUtilTimeout, feedbackObservation,
          originalButtonEverObservedRemoved: removedOriginalButtonRecords > 0,
          originalHeaderEverObservedRemoved: removedOriginalHeaderRecords > 0,
          removedOriginalButtonRecords, removedOriginalHeaderRecords, observedBatches,
          domSamples, domSampleLimit: 64, domSamplesTruncated: domSamples.length === 64,
          postCountAtCleanup: posts().length, postBodies: posts().map(call => call.body),
        }));
`;
fragment = replaceOnce(fragment, '      } finally {\n        stopSamples();\n        view.hold.release();', '      } finally {\n        stopSamples();\n' + log + '        view.hold.release();');
const require = createRequire(`${root}/apps/web/package.json`);
const prettier = require('prettier');
const ts = require('typescript');
const config = await prettier.resolveConfig(`${root}/apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx`);
const formatted = await prettier.format(fragment, { ...config, parser: 'typescript' });
await save('CASES.diagnostic.tsx.fragment', formatted);
const proposed = Buffer.concat([base.subarray(0, 60996), Buffer.from('\n'), Buffer.from(formatted)]);
await save('component.diagnostic.proposed.tsx', proposed);
const diagnostics = (ts.transpileModule(proposed.toString(), { fileName: 'component.diagnostic.proposed.tsx', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).diagnostics ?? []).map(item => ({
    code: item.code, category: ts.DiagnosticCategory[item.category], message: ts.flattenDiagnosticMessageText(item.messageText, '\n') }));
const setup = await readFile(`${root}/apps/web/src/__fixtures__/setup.ts`, 'utf8');
if (!setup.includes('configure({ asyncUtilTimeout: 5000 });')) throw new Error('Recheck existing default waitFor binding');
const before = JSON.parse(await readFile(`${sourcePacket}/after.json`, 'utf8'));
for (const [path, expected] of Object.entries(before.overlays)) if (sha(await readFile(join(root, path))) !== expected) throw new Error('Live overlay drift');
const assertions = text => text.split('\n').filter(line => /expect|\.to[A-Z]/.test(line));
const originalAssertions = assertions(originalFragment);
let cursor = 0;
for (const line of assertions(formatted)) if (line === originalAssertions[cursor]) cursor++;
if (cursor !== originalAssertions.length) throw new Error('Existing assertion text/order changed');
const binding = {
  executionAdmitted: false, candidateHead: before.head, candidateTree: before.tree, rawIndexSha256: before.indexSha256,
  base63Sha256: sha(base), proposedSha256: sha(proposed), proposedBytes: proposed.length,
  fragmentSha256: sha(Buffer.from(formatted)), unchanged61PrefixBytes: 60996,
  unchanged61PrefixSha256: sha(proposed.subarray(0, 60996)), original49PrefixSha256: sha(proposed.subarray(0, 35518)),
  originalAssertionsRetainedInOrder: true, plannedCases: 63, plannedSelected: 63, plannedFiltered: 0,
  originalResultManifestSha256: sha(manifestBytes), originalResultMembersReverified: members.length,
  currentFiveOverlayPins: before.overlays, existingDefaultWaitForMs: 5000, testTimeoutMs: 20000,
  hookTimeoutMs: 20000, retry: 0, maxWorkers: 1,
  diagnosticOnly: true, originalImmediateFeedbackCaptureAndAssertionRetained: true,
  addsExplicitDeadlineOverride: false, addsPrivateStateOrCounterReset: false,
  syntaxOnlyDiagnostics: diagnostics, semanticChecksRun: false, applicationImported: false,
  formatterVersion: prettier.version, syntaxParserVersion: ts.version, node: process.version,
  scope: 'One proposed full63 diagnostic; bounded public DOM identity/removal and default feedback wait. Original strict result cannot be converted to acceptance by delayed observation.'
};
await save('BINDING.json', JSON.stringify(binding, null, 2) + '\n');
if (diagnostics.some(item => item.category === 'Error')) throw new Error('Syntax diagnostics');
process.stdout.write(JSON.stringify({ proposedSha256: binding.proposedSha256, fragmentSha256: binding.fragmentSha256,
  originalAssertionsRetainedInOrder: true, plannedCases: 63, syntaxOnlyDiagnostics: diagnostics,
  existingDefaultWaitForMs: 5000, noCheckoutWrites: true }, null, 2) + '\n');
