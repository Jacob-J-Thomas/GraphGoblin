# Chat browser finalization recovery

This packet retains the additional bounded browser observation for [issue #519](https://github.com/Jacob-J-Thomas/GraphGoblin/issues/519), separately from the [Chat recovery focus diagnosis](../2026-11-19-chat-recovery-focus/README.md). **The actual “Record again” control received focus and supported keyboard recovery. The specific “Try again” browser criterion remains unverified because that control was absent on this real recorder failure path.** This observation does not establish the old hosted test's callback ordering.

The tested candidate was `babba15fd5aa0444636607c6acbf3ead7ec98c47`, tree `98d3da3d511ee93c579421fde746aea52153088f`. The independent checkout stayed clean. Node 22.23.4/pnpm 12.8.1 built 12/12 tasks. A fresh headed Chromium context loaded the built app through the maintained [browser harness](../../../apps/web/e2e/server.ts), using its no-key main API, in-memory database, disposable test directory and fake harness/decider/classifier/structured ports. No owner state, authentication, live user service or real provider was used. [Source, build and boundary identities](raw/identity-and-boundaries.json)

## Simulated boundary and actual interaction

The maintained [voice browser fixture](../../../apps/web/e2e/chat-voice.spec.ts) supplied its public-domain JFK WAV to Chromium's fake microphone. AudioContext, AudioWorklet, PCM chunks, sample counts and acknowledgements remained native. The sole induced fault suppressed one outgoing capture-worklet **stop** message. The real [recorder](../../../apps/web/src/chat/recorder.ts) then reached its unchanged **3,000 ms finalization deadline**. No clock or product promise/rejection was replaced.

1. Actual Mic and Escape retained one native synthetic recording without upload.
2. Actual Add more and Send reached the induced finalization timeout. The alert reported that the final words were not confirmed and the last recording was not saved.
3. The real recovery action was **Record again**. Actual `document.activeElement` equaled that same button; **Try again count was zero**. The [Chat surface](../../../apps/web/src/chat/ChatSurface.tsx) offers this action when the real recorder sets its retry error state. The unit test's mocked freeze rejection omits that recorder state and reaches **Try again** instead.
4. Without forcing focus, actual Enter activated the already focused **Record again** button and started another native capture. Actual Escape finalized it. Two recordings remained, the alert cleared and the textarea owned focus. Browser POSTs remained empty; the disposable backend separately reported zero conversations and zero harness starts.

[Complete capture/focus/alert observations](raw/observations.json) retain the original raw log hashes. [Failure screenshot](raw/failure-focused.png) and [keyboard recovery screenshot](raw/keyboard-recovered.png) show the actual UI. The failed capture was not acknowledged as stopped; the first and recovered captures were. No upload, turn, normalizer execution or provider activity occurred.

## Chronology, limits and first errors

This was one visible foreground Windows Chromium journey: `hidden=false`, `visibilityState=visible` and document focus were observed. No background-tab transition, OS focus switching, other browser or screen-reader announcement was exercised. The native focus event and alert mutation-observer callback share browser task delivery; their timestamps do not establish a universal alert-before-effect order. This is not proof of the old hosted timing or of real microphone quality, transcription or submission recovery.

The separate mocked **Try again** diagnosis preserves the original **20-second test deadline** and **five-second async deadline**. This browser observation preserves the recorder's **three-second finalization deadline** and does not change or replace those unit assertions. Its source is the historical candidate above; retention here adds no behavior run or qualification of a later head.

The first setup read preceded the harness-ready receipt and failed. After actual readiness was observed, the single browser failure/recovery journey completed. An optional final user-agent metadata read failed with a CLI syntax error and was not retried; that metadata remains unobserved. [Setup and metadata errors](raw/setup-errors.json) explicitly distinguish the transcribed first setup errors from the separately retained raw logs. The browser closed, the maintained harness exited 0, both listeners closed and the source stayed clean.

## Retention and independent replay

This directory follows the [QA evidence retention rule](../../15-issue-workflow.md). Its raw JSON and JavaScript retain the sealed public packet's exact bytes. The upstream manifest's `README.md` maps to `raw/README.original.txt`; the other upstream entries retain their names under `raw/`. The external browser packet and earlier focus-diagnosis packet remain immutable. [Selection and original hashes](selection.json) · [Original public manifest](raw/artifact-manifest.json) · [Original report](raw/README.original.txt)

From this directory, run `node raw/verify-records.mjs` under Node 22.23.4. This read-only independent replay recomputes the 12 selected recorded facts; it does not start a browser or change the packet. Run `node verify-publication.mjs` to additionally verify all retained bytes, the original manifest mapping and repository links. [Original verification](raw/verification.json) · [Retention replay](replay-verification.json) · [Retention checks](retention-verification.json) · [Publication manifest](publication-manifest.json)
