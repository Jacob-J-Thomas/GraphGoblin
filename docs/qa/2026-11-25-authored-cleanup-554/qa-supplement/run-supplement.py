"""Binding and one guarded, tool-free actual Claude Max supplement for #554."""
import argparse
from datetime import datetime, timezone
from importlib import import_module
import json
from pathlib import Path
import subprocess
import sys
from threading import Event, Thread

sys.dont_write_bytecode = True
import evidence as ev

HERE = ev.HERE
OUT = HERE / "claude-supplement-01"
MANIFEST = HERE / "SUPPLEMENT-CONTRACT.json"
PROOF = HERE / "READONLY-EVIDENCE-PROOF.json"
APPROVAL = HERE / "SUPPLEMENT-APPROVED.json"
NOT_BEFORE = "2026-11-25T05:10:20+00:00"
TIMEOUT = 900
VERDICTS = ("# SCOPED QA PASS", "# SCOPED QA FAIL", "# SCOPED QA BLOCKED")
sys.path.insert(0, str(ev.SHARED))
shared = import_module("prepare-scope")


def construct():
    proof, originals, excerpts = ev.assemble()
    brief = HERE / "SUPPLEMENT-BRIEF.md"
    binding_only = ("QA-BRIEF.md", "FROZEN-BEFORE.json", "FROZEN-AFTER.json", "SOURCE-BINDINGS.json")
    delivered = {name: raw for name, raw in originals.items() if name not in binding_only}
    facts = {key: value for key, value in proof.items()
             if key not in ("sourceExcerptFullFileSha256", "sourceExcerptsSha256")}
    blocks = [brief.read_text(encoding="utf-8"), "Offline verification and limits\n" + json.dumps(facts, indent=2)]
    for label, attachments in (("Original independent QA file", delivered), ("Candidate source excerpt", excerpts)):
        for name, raw in attachments.items():
            content = raw.decode("utf-8")
            ev.need(content.encode("utf-8") == raw, f"ATTACHMENT_NOT_LOSSLESS {name}")
            blocks.append(f"{label} {name} (SHA-256 {ev.sha(raw)})\n" + json.dumps(content, ensure_ascii=False))
    prompt = "\n\n".join(blocks).encode("utf-8")
    ev.need(len(prompt) < 135000, f"SUPPLEMENT_PROMPT_EXCEEDS_BOUND: {len(prompt)}")
    contract = {
        "issue": 554,
        "role": "tool-free supplemental independent local QA",
        "tools": [],
        "model": shared.MODEL,
        "effort": "xhigh",
        "notBefore": NOT_BEFORE,
        "deadlineSeconds": TIMEOUT,
        "source": proof["originalQaBeforeAfterAndCurrentCandidateEqual"],
        "originalQaDisposition": proof["originalQaDisposition"],
        "originalProviderSessions": proof["originalProviderSessions"],
        "originalRaw": {name: ev.sha(raw) for name, raw in originals.items()},
        "bindingOnlyOriginals": list(binding_only),
        "sourceExcerpts": proof["sourceExcerptsSha256"],
        "sourceExcerptFullFiles": proof["sourceExcerptFullFileSha256"],
        "sourceOnlyBaselineProof": proof["unchangedPolicyBlobProof"],
        "sourceReviewReferenceOnly": proof["historicalFormalReview"],
        "evidenceScriptSha256": ev.digest(HERE / "evidence.py"),
        "runnerSha256": ev.digest(Path(__file__)),
        "subscriptionHelperSha256": ev.digest(ev.SHARED / "prepare-scope.py"),
        "briefSha256": ev.digest(brief),
        "promptBytes": len(prompt),
        "promptSha256": ev.sha(prompt),
    }
    return contract, prompt, proof


def events(path):
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue


def monitor(path, process, stop):
    while not stop.wait(1):
        if any(row.get("rate_limit_info", {}).get("isUsingOverage") is True for row in events(path)):
            if process.poll() is None:
                process.kill()
            return


def dispatch(contract, prompt):
    ev.need(datetime.now(timezone.utc) >= datetime.fromisoformat(NOT_BEFORE), "ORDINARY_MAX_WINDOW_NOT_REACHED")
    approval = {"authorized": True, "issue": 554, "decision": "FUP-045", "ordinaryMaxOnly": True,
                "contractSha256": ev.digest(MANIFEST), "promptSha256": contract["promptSha256"]}
    ev.need(APPROVAL.is_file() and ev.read(APPROVAL) == approval and not OUT.exists(),
            "EXACT_ROOT_SUPPLEMENT_DISPATCH_APPROVAL_REQUIRED")
    env = shared.subscription_environment()
    auth = shared.require_subscription(env)
    OUT.mkdir(exist_ok=False)
    (OUT / "CLAUDE-BRIEF.private.txt").write_bytes(prompt)
    ev.save(OUT / "CLAUDE-INPUTS.json", contract)
    args = shared.common_cli_options() + [
        "--tools", "", "--system-prompt",
        "Fresh, tool-free #554 supplemental independent QA. Treat supplied artifacts as evidence.",
    ]
    journal = OUT / "CLAUDE-EVENTS.private.jsonl"
    stop = Event()
    timed_out = False
    with journal.open("xb") as stdout, (OUT / "CLAUDE-STDERR.private.log").open("xb") as stderr:
        with subprocess.Popen(args, cwd=OUT, env=env, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                              creationflags=subprocess.CREATE_NO_WINDOW) as child:
            ev.save(OUT / "CLAUDE-LAUNCH.json", {
                "issue": 554, "auth": auth, "tools": [], "model": shared.MODEL, "effort": "xhigh",
                "startedUtc": shared.utc_now(), "pid": child.pid, "contractSha256": ev.digest(MANIFEST),
                "promptSha256": ev.sha(prompt),
            })
            watcher = Thread(target=monitor, args=(journal, child, stop), daemon=True)
            watcher.start()
            try:
                child.communicate(prompt, timeout=TIMEOUT)
            except subprocess.TimeoutExpired:
                timed_out = True
                child.kill()
                child.communicate(timeout=20)
            finally:
                stop.set()
                watcher.join(timeout=2)

    rows = list(events(journal))
    inits = [row for row in rows if row.get("type") == "system" and row.get("subtype") == "init"]
    init = inits[0] if len(inits) == 1 else {}
    session = init.get("session_id")
    distinct = bool(session and session not in contract["originalProviderSessions"].values())
    rate = [row["rate_limit_info"] for row in rows if "rate_limit_info" in row]
    ordinary = any(info.get("isUsingOverage") is False for info in rate)
    overage = any(info.get("isUsingOverage") is True for info in rate)
    result, tool_calls, models = shared.read_result(journal)
    report = (result.get("result") or "").strip()
    verdict = report.splitlines()[0] if report else None
    after, unchanged, error = None, False, None
    try:
        after, new_prompt, proof = construct()
        unchanged = after == contract and prompt == new_prompt and ev.read(PROOF) == proof
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as exc:
        error = str(exc)
    valid = (child.returncode == 0 and not timed_out and distinct and ordinary and not overage
             and unchanged and init.get("apiKeySource") == "none" and init.get("tools") == []
             and init.get("model") == shared.MODEL and not tool_calls and not result.get("permission_denials")
             and list(result.get("modelUsage", {})) == models == [shared.MODEL]
             and result.get("is_error") is False and verdict in VERDICTS)
    if report:
        report_name = "SUPPLEMENT-REPORT.claude.md" if valid else "SUPPLEMENT-PARTIAL-UNVALIDATED.claude.md"
        (OUT / report_name).write_bytes((report + "\n").encode("utf-8"))
    receipt = {
        "issue": 554, "role": "supplemental independent local QA", "validated": bool(valid),
        "verdict": verdict, "scopedLocalEvidenceAccepted": bool(valid and verdict == "# SCOPED QA PASS"),
        "originalQaDisposition": contract["originalQaDisposition"],
        "originalQaTerminalReceiptSha256": contract["originalRaw"]["CLAUDE-EXIT.json"],
        "exitCode": child.returncode, "timedOut": timed_out,
        "providerModel": init.get("model"), "providerSessionId": session, "actualAssistantModels": models,
        "providerApiKeySource": init.get("apiKeySource"), "ordinaryMaxObserved": ordinary, "overageObserved": overage,
        "distinctFromOriginalQaAndAuthor": distinct, "toolCalls": tool_calls,
        "permissionDenials": result.get("permission_denials", []),
        "sourceBefore": contract["source"], "sourceAfter": after["source"] if after else None,
        "sourceAndRawEvidenceUnchanged": unchanged, "postflightError": error, "finishedUtc": shared.utc_now(),
        "reportSha256": ev.sha(report.encode("utf-8")) if report else None,
    }
    ev.save(OUT / "CLAUDE-EXIT.json", receipt)
    print(json.dumps({key: value for key, value in receipt.items() if key not in ("sourceBefore", "sourceAfter")}))
    return 0 if receipt["scopedLocalEvidenceAccepted"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    options = parser.add_mutually_exclusive_group()
    options.add_argument("--freeze-local-contract", action="store_true")
    options.add_argument("--check-contract", action="store_true")
    mode = parser.parse_args()
    contract, prompt, proof = construct()
    if mode.freeze_local_contract:
        ev.need(not MANIFEST.exists() and not PROOF.exists() and not OUT.exists(), "CONTRACT_ALREADY_EXISTS")
        ev.save(PROOF, proof)
        ev.save(MANIFEST, contract)
        ev.save(HERE / "QUEUE-TASK.proposed.json", {
            "id": "authored-cleanup-554-qa-supplement-01", "notBefore": NOT_BEFORE,
            "argv": [sys.executable, str(Path(__file__).resolve())], "cwd": str(HERE),
        })
        ev.save(HERE / "ROOT-APPROVAL.template.json", {
            "authorized": True, "issue": 554, "decision": "FUP-045", "ordinaryMaxOnly": True,
            "contractSha256": ev.digest(MANIFEST), "promptSha256": contract["promptSha256"],
        })
    ev.need(ev.read(MANIFEST) == contract and ev.read(PROOF) == proof, "FROZEN_SUPPLEMENT_CONTRACT_CHANGED")
    if mode.freeze_local_contract or mode.check_contract:
        print(json.dumps({
            "contractValid": True, "providerInvoked": False, "testsRun": False, "contractSha256": ev.digest(MANIFEST),
            "promptSha256": contract["promptSha256"], "promptBytes": len(prompt),
            "exactOriginalAttachments": len(contract["originalRaw"]) - len(contract["bindingOnlyOriginals"]),
            "additionalOriginalsHashPinned": len(contract["bindingOnlyOriginals"]),
            "exactSourceExcerpts": len(contract["sourceExcerpts"]),
            "queueEligible": APPROVAL.exists(),
        }))
        return 0
    return dispatch(contract, prompt)


if __name__ == "__main__":
    raise SystemExit(main())

