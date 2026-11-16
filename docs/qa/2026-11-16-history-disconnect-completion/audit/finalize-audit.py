from pathlib import Path
import hashlib
import json
from datetime import datetime, timezone

ROOT = Path(r"C:\Users\98jak\graphgoblin-qa\2026-11-13-aidlc-batch\review-419-astra-scan2").resolve()
EVIDENCE = ROOT.parent
HEAD = "497acaa602959bc828e8f1e90f2dce0a576a3492"
TREE = "88ade580c80b2139b5d1bf51449dca10e33184f1"
TARGET = "98692c8a8c7b519e8c83e585e026d595cedc0550"
SOURCE = "7b7932f89b038a4635183b6adbc5fefa6df4fa6f"
MERGE = "387322e7f7d2b2f4a48c149aeaea2fc4f3001996"

def read(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8-sig"))
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def record(path, relative_to):
    return {"path": path.relative_to(relative_to).as_posix(), "bytes": path.stat().st_size, "sha256": sha(path)}
def write(name, payload):
    (ROOT / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

local = read("final-local-readback.json")
assert local["identity"] == [HEAD, TREE, "9439a500040aa4763613549cca6235023916de58", "e6d5811824f170e36d5a90038486a5531feca255", TREE]
assert local["identityExit"] == local["statusExit"] == local["parentExit"] == 0
assert not local["status"] and local["indexUnchanged"]
assert local["indexHash"] == local["initialIndexHash"] == "48a80256ea53c4bb8ca7fc4a7393e093fcfc1648196644729ae7693a2db1d167"
remote = read("final-remote-readback.json")
assert all(r["status"] == "fulfilled" for r in remote["results"])
pr, runs, jobs = [r["value"]["structuredContent"] for r in remote["results"]]
assert (pr["head_sha"], pr["base_sha"], pr["merge_commit_sha"]) == (HEAD, TARGET, MERGE)
assert pr["state"] == "open" and pr["draft"] and not pr["merged"] and pr["mergeable"]
ci = next(r for r in runs["workflow_runs"] if r["id"] == 43773546178)
assert ci["status"] == "completed" and ci["conclusion"] == "success"
assert len(jobs["jobs"]) == 4
assert all(j["status"] == "completed" and j["conclusion"] == "success" for j in jobs["jobs"])
gates = next(j for j in jobs["jobs"] if j["id"] == 133004478824)
assert len(gates["steps"]) == 32 and all(s["conclusion"] == "success" for s in gates["steps"])
report = (ROOT / "full-report.md").read_text(encoding="utf-8")
assert report.startswith("Independent final audit") and "\nSIGN-OFF." in report
for value in [HEAD, TREE, TARGET, SOURCE, MERGE]:
    assert value in report
artifact = read("artifact-verification.json")
assert artifact["result"] == "all asserted offline checks passed"
details = read("detail-verification.json")
assert details["result"] == "all detail assertions passed" and details["linkTotal"] == 166
publication = read("publication-verification.json")
assert all(row["exactTextPresent"] for row in publication["textChecks"])
assert publication["externalFutureOpusPacket"]["manifestRowsVerified"] == 26
assert publication["externalFutureOpusPacket"]["originalCopyPairsVerified"] == 23
for name in ["artifact-verification-attempt1.log", "artifact-verification-attempt2.log", "inspect-artifacts.attempt1.py", "inspect-artifacts.attempt2.py", "identity-correction.json"]:
    assert (ROOT / name).is_file()
for i, expected in [(1, 1), (2, 1), (3, 0)]:
    assert read(f"artifact-verification-attempt{i}-exit.json")["exitCode"] == expected

input_names = [
    "runtime-419-astra-dispatch.md", "runtime-419-astra-brief.md", "runtime-419-opus-dispatch.md",
    "runtime-419-implementation-brief.md", "runtime-419-post410-preflight.md",
    "runtime-contract.md", "runtime-acceptance-map.md",
    "runtime-419-source-root-acceptance.json",
    "runtime-419-baseline-acceptance.json", "runtime-419-baseline-report-root-acceptance.json",
    "runtime-419-candidate-report-root-acceptance.json",
    "runtime-490-ci-root-acceptance.json", "runtime-490-second-coverage-root-readback.json",
    "runtime-490-green-root-live-readback.json", "runtime-490-ci-publication-root-acceptance.json",
    "runtime-419-opus-root-disposition.md", "runtime-419-opus-published-readback.json",
    "runtime-419-opus-publication-root-acceptance.json",
    "review-419-opus-scan1/full-report.md", "review-419-opus-scan1/provider-final-message.md",
]
inputs = []
for name in input_names:
    path = EVIDENCE / name
    assert path.is_file(), name
    inputs.append(record(path, EVIDENCE))
write("admitted-input-final-hashes.json", {
    "utc": datetime.now(timezone.utc).isoformat(),
    "meaning": "Final hashes of the admitted external briefs and principal reviewed receipts; detailed native/archive/CI hashes are in artifact-verification.json. This is not a full new execution or a new acceptance.",
    "files": inputs
})

summary = {
    "verdict": "SIGN-OFF",
    "role": "Independent Astra MAX final audit, formal scan 2 of 3 maximum",
    "head": HEAD, "tree": TREE, "target": TARGET, "targetTree": "9439a500040aa4763613549cca6235023916de58",
    "source": SOURCE, "sourceTree": "e6d5811824f170e36d5a90038486a5531feca255", "testedMerge": MERGE,
    "finalLocalUTC": local["utc"], "finalRemoteUTC": remote["utc"],
    "currentIndexSha256": local["indexHash"], "currentIndexUnchanged": True,
    "cleanCheckout": True, "newActionableFindings": 0, "additionalFormalScans": 0,
    "newProductExecutions": 0, "productOrGitHubMutations": 0,
    "ciRun": 43773546178, "gatesJob": 133004478824, "successfulGateSteps": 32,
    "preservedQualifications": [
        "Source candidate versus documentary publication and historical index distinguished.",
        "Native TCP/file-SQLite proof uses compiled routes, synthetic history and controlled promise/yield gates; no ordinary gateway/browser or SQLite interruption claim.",
        "O1 focused yield regression gap remains deferred P3 #491; mutation statement static only.",
        "O2 queued pipelining observation remains static/unconfirmed, no introduced observed-response contract violation established.",
        "Initial fixture/type/lint failures preserved; final meaningful red 7 failed/3 passed, candidate focused 22 passed.",
        "Original local API coverage EPERM remains failed with no aggregate; isolated 7/7 is diagnostic; #489 retains it.",
        "Original whole-job CI deadline remains failed; one unchanged Gates-only retry passed; companions are carried executions; #488 retains deadline.",
        "Browser skip/strict-performance limit, missing Windows artifact, remaining low/moderate advisories and earlier review/process errors preserved.",
        "Future CI and corrected Opus archival packets are external and not part of reviewed head.",
        "This verdict is not owner acceptance, merge action or whole-intent/batch completion."
    ],
    "report": record(ROOT / "full-report.md", ROOT),
    "result": "Report identity and terminal receipts internally consistent; offline artifact validations complete."
}
write("audit-result.json", summary)
excluded = {"audit-seal.json", "SHA256SUMS.txt"}
payloads = []
for path in sorted(ROOT.rglob("*")):
    if path.is_file() and path.name not in excluded:
        assert path.resolve().is_relative_to(ROOT)
        payloads.append(record(path, ROOT))
seal = {
    "utc": datetime.now(timezone.utc).isoformat(),
    "verdict": "SIGN-OFF",
    "head": HEAD, "tree": TREE, "target": TARGET, "source": SOURCE, "testedMerge": MERGE,
    "payloadCount": len(payloads),
    "excludes": ["audit-seal.json", "SHA256SUMS.txt"],
    "qualification": "Seals read-only audit artifacts, including failed diagnostics. Does not attest new product execution or owner acceptance.",
    "payloads": payloads
}
write("audit-seal.json", seal)
manifest_records = payloads + [record(ROOT / "audit-seal.json", ROOT)]
manifest_records.sort(key=lambda x: x["path"])
(ROOT / "SHA256SUMS.txt").write_text("".join(f"{row['sha256']}  {row['path']}\n" for row in manifest_records), encoding="utf-8")
for row in manifest_records:
    assert sha(ROOT / row["path"]) == row["sha256"]
print(json.dumps({
    "verdict": "SIGN-OFF",
    "report": record(ROOT / "full-report.md", ROOT),
    "seal": record(ROOT / "audit-seal.json", ROOT),
    "manifest": record(ROOT / "SHA256SUMS.txt", ROOT),
    "payloadsSealed": len(payloads),
    "manifestRows": len(manifest_records),
    "filesTotal": len(manifest_records) + 1,
    "terminalIdentity": {"head": HEAD, "tree": TREE, "target": TARGET, "testedMerge": MERGE},
    "newProductExecution": False,
    "newFindings": 0
}, indent=2))

