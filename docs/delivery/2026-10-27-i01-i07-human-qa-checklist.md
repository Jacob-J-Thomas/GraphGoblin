# I01-I07 human QA checklist (integrated build)

This is the one checklist for the owner's human QA of the I01-I07 delivery. Engineering is merged and verified (see the [reconciliation](2026-10-27-i01-i07-reconciliation.md)); nothing below has been performed by the owner, and no agent observation marks any item complete. Each item says what to do, what you should see, and what to decide. Items marked **Decide** are product judgements the records could not settle; the rest confirm that the behaviour is what you want.

## Setup (once)

1. Use a build of `main` at the integrated commit named in the reconciliation (or later). Do not use your own instance or store: start a disposable one.
2. In PowerShell, from a checkout of that commit, with Node 22.22.2 or later first on `PATH`:

   ```powershell
   pnpm.cmd install
   pnpm.cmd build
   $env:GG_DATA_DIR = Join-Path $env:TEMP ('gg-owner-qa-' + [guid]::NewGuid().ToString('N'))
   $env:GG_PORT = '4810'
   $env:GG_REQUIRE_API_KEY = 'false'
   $env:GG_SHUTDOWN_GRACE_MS = '60000'
   node apps/api/dist/main.js
   ```

3. Open `http://127.0.0.1:4810/app/` in Edge. Your own instance on 4747/4748 is not touched. Remove the `gg-owner-qa-*` directory afterwards.

## 1. History deletion and storage pressure (#187, #322)

- **Mark history delete-ready.** In Runs, select two finished runs, choose **Review delete-ready history**, read the preview, confirm. Then withdraw one. Expect: the preview names exactly the selected runs and any related runs with reasons; a running or paused run in the selection refuses the whole selection with its reason; Cancel and Escape change nothing; the inspector shows "Delete-ready: confirmed by local at <your local time>"; withdrawing clears it.
- **Decide (#187):** the confirmation dialog lists bare run IDs. Is that enough, or should it show loop name, status and time ([record](../qa/2026-10-27-pr412-qa-final/README.md), `ui-review-dialog.png`)?
- **Storage notice.** Simulating low storage needs the public capacity dependency; the QA records show it ([pressure](../qa/2026-10-27-pr412-qa-final/ui-notice-pressure-loops.png), [no eligible history](../qa/2026-10-27-pr412-qa-final/ui-notice-no-eligible-runs.png)). **Decide (#322):** the notice is a full-width amber box below the top navigation on every page, not dismissible. Keep it global, or show it only on Runs? Are its three texts right?
- **Decide (#322):** artifacts of approved runs are reclaimed only when the retained history is small enough to prove them unreferenced (ADR-0060's bounded proof); at a few hundred runs only workspaces are reclaimed. Acceptable for now?
- **Decide (#413):** deleting a loop leaves its runs' files on disk. Should loop deletion hand them to the same ownership-checked removal, or should its dialog say files stay?

## 2. Recovery: Resume and Replay (#256)

- Run a loop whose script exits non-zero; in the inspector, Resume is offered and explained; fix the cause, Resume continues the same run ID.
- Open **Replay** on a finished run at an inference node. Read the dialog: "Replay runs again from the chosen node as a separate run with a new ID. Scripts, provider turns, child runs and deliveries after that node run again for the new run. It does not undo the source's recorded effects or results, or resend the source's own recorded deliveries." Confirm; a new run opens, linked to its source.
- Open two tabs on the same failed run; Resume in one, then in the other. Expect the second to be refused with "The run changed since it was shown. Refresh and review its current recovery choices."
- **Decide (#256):** are the Resume/Replay explanations and the uncertain-script consent wording ("I explicitly allow the current uncertain script to run again; its effect may already have happened.") clear? During a fast-cycling run, Resume's unavailable reason often reads "The run changed while its recovery state was being read." Is that distracting ([F1 record](../qa/2026-10-27-final-f1-integrated/README.md))?
- If you use a screen reader, listen to the disabled-action explanations and the stale-action alert (agents checked the accessibility tree, not spoken output).

## 3. Deliberate shutdown (#319)

Follow acceptance C's HQ-1 steps ([record](../qa/2026-10-26-acceptance-c/README.md), "Human QA items"): two loops (a script waiting for a file, and a parent with a subloop), drain through the API, watch the notice through the grace, open and cancel the force confirmation, keep waiting, then force, restart and open an interrupted run. Also press Ctrl+C once in the API's own terminal while a Codex turn runs: the gateway drains and the turn keeps running (fixed by #417; live check in the F2 record).

- **Decide (#319):** (a) are loop name, run ID and link enough to "explain active work", or should the current node or elapsed time show; (b) is offering Keep waiting before the grace intended (it suppresses the later prompt); (c) are the forcing text and the "changed in another tab or control" message after a grace expiry acceptable; (d) should interrupted runs offer a browser Replay instead of API/MCP only.

## 4. Sessions, models and effort (#33, #205, #265)

- **#205:** open an inference node's Settings: Model and one Effort control are visible outside Advanced; "Default (medium)" names the inherited effort. Switch a node at effort `max` to GPT-5.5: the Effort field explains that GPT-5.5 does not support `max` and the node lists the issue until you choose another effort.
- **Decide (#33, acceptance A H1):** own-session continuity is expressed through the Session policy dropdown (`fresh`, `resume-previous`, `resume-named`, `resume-own`) plus the prompt and Context inputs, with "Reset after visits" for `resume-own`. Is that explicit enough, or do you want a dedicated context-mode control or friendlier labels? Steps in [acceptance A](../qa/2026-10-26-acceptance-a/README.md), "H1".
- **Decide (#265, acceptance A H2):** after a child run's missing session is recovered with **Start fresh session**, the failed parent can only be resumed through the API or MCP (the inspector offers Resume only for paused runs). Acceptable? Steps in [acceptance A](../qa/2026-10-26-acceptance-a/README.md), "H2".

## 5. Long runs and history (#186, #116, #185, #240, #255)

- **#186:** start an endless cyclic loop and follow it live in the inspector past a few thousand events; it keeps its pace. **Decide:** the live view no longer shows the latest completion's patch diff; you select a completion to see it (which pauses following). Should the page say so ([record](../qa/2026-10-26-pr418-qa/README.md), "Human QA item")?
- **#116:** with two tabs open on a run, fail it, Resume it, let it succeed: both tabs follow each attempt.
- **#185:** a run whose webhook return is held shows "Execution: succeeded" with the delivery pending until it finalizes.
- **#240:** on Events, new events show a "New events available" notice and arrive only when you choose Refresh; filters and scroll stay.
- **#255:** in an inspector, array appends show the inserted value, route probabilities are readable, cancellations name who cancelled.

## 6. Questions raised by findings (follow-up issues)

- **#415:** should actions taken through MCP be attributed to an MCP client rather than the local user (or the unused actor kind removed)?
- **#416:** should the inspector keep showing the last-known run evidence while the API is offline?

## Live provider results

The live-provider checks ran once on the integrated build with 30 real turns (`docs/qa/2026-10-27-final-f2-live/README.md`): a real console Ctrl+C during a Codex turn drains and the turn completes; an explicit force during a long Codex command ends the whole CLI tree within a second and the provider-side session stops; `max` is sent and recorded as `max`; own-session continuity recalls a nonce in both providers and resets after N visits; a real missing session is refused truthfully and one fresh turn follows the explicit choice; a loop built in the editor runs with Codex and with Claude and keeps its pinned version across a new publish; a native script-tree force kills the root and its descendant and leaves truthful, non-resumable records. The two defects it found (Codex `minimal` offered but refused by the provider; that refusal recorded with the wrong cause) were fixed in PR #426, merged as `867b15ddca6435e0ad5d900ac57da2f9f1d7e52c` on the review cap's documented path (three scans, the last one's findings fixed and independently QA'd without a sign-off; [record](../qa/2026-10-27-f2-fixes/README.md)). Its first QA spent two more real Codex turns, one of them the refused `minimal`, and observed the truthful record; the whole live set was not rerun on the merged build.

- **Decide (#205):** the provider lists `none` as a valid effort for GPT-6 models. Offering it means adding it to the effort scale; it is not offered today.
- **Decide (#423):** every real Codex turn started your own Codex extensions (`node_repl.exe`, `codex-code-mode-host.exe`) inside the turn, which docs/06 says should not happen. Should loop turns inherit your personal Codex MCP servers and plugins?
- **Decide (#425):** a hands-on pass over the authoring flow: a Wait added from the palette can overlap a Decision card once it grows a third port, and two edge labels can overlap.
- Provider session records from the live checks remain in your provider homes: about 14 Codex history files under `%USERPROFILE%\.codex\sessions\2026\10\27` and 5 Claude project folders under `%USERPROFILE%\.claude\projects` named `...-gg-final-f2-...`. They hold only the QA prompts; remove them by hand if you want.
