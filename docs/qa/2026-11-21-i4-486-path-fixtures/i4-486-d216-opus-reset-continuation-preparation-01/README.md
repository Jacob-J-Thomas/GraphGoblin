# D216 Opus reset continuation preparation

Preparation only. The controller and provider have not been started. Root execution remains false in `config.template.json`. No e630 QA verdict is claimed.

The original 42-member quota packet remains immutable at `G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-independent-01`. Its actual failure, epoch 1795417200 reset, D217 decision, root verification and exact public-readback receipts are bound by hash. The failed attempt has no model inference or executed tools/tests. No older 6de observation is relabeled as e630 execution.

The session controller waits until November 23, 2026 at 07:00 UTC / 01:00 America/Chicago. It sleeps for up to 60 seconds between clock checks, prints only bounded state summaries, and makes no pre-reset provider calls. It permits one actual Opus `claude-opus-5-5` / xhigh call in fresh `i4-486-d216-independent-02`, using the existing frozen detached sparse QA checkout at e630/tree0713. It does not reinstall dependencies or create another checkout.

At startup and again at reset it verifies the original quota seal, preparation seal, D216/D217/root receipts, exact candidate admission, source HEAD/tree/parent, clean status, index bytes/staged entries, fixture, lockfile, sparse patterns, dependency metadata and unchanged independent common main. It rejects changed root execution config, existing session/output directories, wrong model or source, and expired launch deadline. Root may stop a waiting controller by changing its admitted config or terminating its own controller process; a changed config is rejected before dispatch. No repository source/index writes occur in the controller.

Launch is allowed only from reset through 09:00 UTC on November 23. An actual provider call is bounded to 7200 seconds. On timeout it terminates only the owned runner process tree, retains raw outputs and records possible interrupted fixture restoration/native cleanup. It never repairs source or retries automatically. Root must inspect any timeout/drift before reuse. The actual provider executes the admitted temporary fixture controls and native cases, with final restoration. Parent logs/cache/TEMP stay G; only its controlled tiny worker C fixture is admitted.

The controller preserves complete raw provider records, verifies one nonerror completed terminal, actual assistant/modelUsage identity, exact final-message bytes, report and QA manifest, then writes an orchestration readback and closed-provider seal. This is a protocol check; root still reads and accepts or rejects the actual report. A quota/error/cleanup mismatch remains blocked. No account/model fallback, overage enablement, standing app automation, source commit, GitHub action, CI rerun or final admission occurs.

Final current-head/current-target CI/native verification, three-scan capped disposition and signed merge remain separate. All three general scans remain consumed; no fourth review or reset of that count is admitted.

Offline verification ran the readonly source/input validation and the actual-clock pre-reset dispatch guard (exit23), with zero provider calls. The wait loop, real dispatch and forced-timeout branch were not executed. `verification.json` records the initial preparation check; `verification-02.json` records the subsequent guard refinement. Final code syntax/provenance is recorded separately by `completion.json`.

## Root commands after review

Create a fresh admitted config outside this sealed preparation. This command changes only the literal root execution boolean and refuses an existing destination:

```powershell
python -B -c "import json,pathlib; p=pathlib.Path('G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-opus-reset-continuation-preparation-01/config.template.json'); c=json.loads(p.read_bytes()); assert c['rootExecutionAuthorized'] is False; c['rootExecutionAuthorized']=True; q=p.parent.parent/'i4-486-d216-opus-reset-controller-config.root-admitted-01.json'; q.open('x',encoding='utf-8').write(json.dumps(c,indent=2)+'\n')"
```

Start this as a root-owned background exec session, using a short initial yield so other work can continue:

```powershell
python -B 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-opus-reset-continuation-preparation-01/controller.py' run --config 'G:/ggq/delivery-evidence/2026-11-17-five-intents/i4-486-d216-opus-reset-controller-config.root-admitted-01.json'
```

The startup `WAITING_FOR_EXACT_RESET` output and `i4-486-d216-opus-reset-controller-01/SESSION.json` prove an actual launch. This preparation does not. Keep the exec session identifier and monitor its final outcome. Do not start a second controller.
