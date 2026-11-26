"""Focused offline CI verifier falsification. Never invokes gh, Git, Node, CI or product code."""
import ast
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from runpy import run_path
from zipfile import ZipFile

O = Path(__file__).resolve().parent
P = O.parent / "mac-d237-ci-verifier-preparation-01"
SCRIPT = P / "verify-mac-ci.py"
WORKFLOW = Path("G:/ggq/gg-macos-current-main/GraphGoblin/.github/workflows/ci.yml")
OLD_CI = O.parent / "i5-557-head2ac09-target3a694-ci-01"
OLD_MAC = Path("C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher/macos-pr501-ci-14/artifacts/macos-launcher-14362060639.zip")
checks, findings = [], []


def descriptor(path):
    data = path.read_bytes()
    return {"source": str(path), "bytes": len(data), "sha256": sha256(data).hexdigest()}


def check(label, value):
    if not value:
        raise AssertionError(label)
    checks.append(label)


check("exact reviewed script pin", descriptor(SCRIPT)["sha256"] == "62798ef7491847f6ee9c8699825ba7e200f4b859100680780cd0dc3ffee3f9bb")
check("exact preparation manifest pin", descriptor(P / "MANIFEST.sha256.json")["sha256"] == "54ef6b1266aa286436fca0fcf33994cb29878b1833a81ec83669603e5bc44bfd")
manifest = json.loads((P / "MANIFEST.sha256.json").read_bytes())
for name, wanted in manifest["files"].items():
    actual = descriptor(P / name)
    check("preparation member " + name, actual["bytes"] == wanted["bytes"] and actual["sha256"] == wanted["sha256"])
check("exact preparation membership", {p.name for p in P.iterdir() if p.is_file()} == set(manifest["files"]) | {"MANIFEST.sha256.json"})
check("actual Mac integration workflow exact pin", descriptor(WORKFLOW)["sha256"] == "e64133d66dbd3506db5f9c6e371abd964488cab89922c5934cea7d7b1021c778")
V = run_path(str(SCRIPT), run_name="independent_offline_definitions_only")
check("no optimized Python asserts in verifier", not any(isinstance(n, ast.Assert) for n in ast.walk(ast.parse(SCRIPT.read_text(encoding="utf-8")))))


def blocked(*args, **kwargs):
    raise AssertionError("Operational dependency was called")


V["get"].__globals__["get"] = blocked
V["subprocess"].check_output = blocked
head, target, merge, runid = "a" * 40, "b" * 40, "c" * 40, 123
repo = {"id": 1, "full_name": V["REPO"]}
attached = {"number": 501, "head": {"repo": repo, "sha": head}, "base": {"repo": repo, "sha": target, "ref": "main"}}
pr = {**attached, "state": "open", "merged": False, "merge_commit_sha": merge}
ref = {"ref": "refs/heads/main", "object": {"sha": target}}
run = {"id": runid, "head_sha": head, "event": "pull_request", "status": "completed", "conclusion": "success",
       "run_attempt": 1, "path": V["WORKFLOW"], "repository": repo, "pull_requests": [attached]}
check("synthetic exact current PR/run binds", V["check_run"](run, pr, ref, 501, runid, head, target) == (merge, 1))


def refused(label, operation):
    try:
        operation()
    except (ValueError, KeyError, TypeError):
        checks.append(label)
        return
    raise AssertionError(label)


for label, other_run, other_pr, other_ref in [
    ("rerun refused", {**run, "run_attempt": 2}, pr, ref),
    ("partial run refused", {**run, "status": "in_progress"}, pr, ref),
    ("failed run refused", {**run, "conclusion": "failure"}, pr, ref),
    ("head drift final readback refused", {**run, "head_sha": target}, pr, ref),
    ("target drift final readback refused", run, pr, {**ref, "object": {"sha": head}}),
    ("PR base drift final readback refused", run, {**pr, "base": {**pr["base"], "sha": head}}, ref),
    ("closed PR refused", run, {**pr, "state": "closed"}, ref),
]:
    refused(label, lambda other_run=other_run, other_pr=other_pr, other_ref=other_ref:
            V["check_run"](other_run, other_pr, other_ref, 501, runid, head, target))
jobs = []
for jid, (name, required) in enumerate(V["JOBS"].items(), 1):
    names = (*required, *(("Run actions/checkout@v4",) if name != "Gates" else ()))
    jobs.append({"id": jid, "name": name, "run_id": runid, "run_attempt": 1, "head_sha": head,
                 "status": "completed", "conclusion": "success",
                 "steps": [{"name": n, "status": "completed", "conclusion": "success"} for n in names]})
check("exact seven synthetic jobs with required successful steps accept", len(V["check_jobs"]({"total_count": 7, "jobs": jobs}, runid, head)) == 7)
refused("historic six-job topology refused", lambda: V["check_jobs"]({"total_count": 6, "jobs": jobs[1:]}, runid, head))
for key, value in [("conclusion", "skipped"), ("status", "in_progress")]:
    changed = deepcopy(jobs)
    changed[0]["steps"][0][key] = value
    refused("required Mac step " + key + " refused", lambda changed=changed: V["check_jobs"]({"total_count": 7, "jobs": changed}, runid, head))
workflow = WORKFLOW.read_text(encoding="utf-8")
check("all required named steps appear in pinned actual workflow", all("- name: " + step in workflow
      for name, steps in V["JOBS"].items() for step in steps))

# Existing historical CI bytes are format fixtures only. No full current run is accepted.
logs = {name: V["log_text"]((OLD_CI / (name.lower().replace(" ", "-") + ".log")).read_bytes())
        for name in V["JOBS"] if name != "macOS launcher"}
oldmerge = json.loads((OLD_CI / "verified.json").read_bytes())["testedMerge"]
check("historical six-log format fixture parses without current-run authority", V["check_logs"](logs, oldmerge)["browserPassed"] > 0)
for label, job, oldtext, replacement in [
    ("browser retry", "Browser", "test --retries=0", "test --retries=1"),
    ("wrong browser skip", "Browser", "e2e/live.spec.ts:", "e2e/other.spec.ts:"),
    ("high audit", "Repository checks", "7 low | 13 moderate", "7 low | 1 high"),
]:
    check("fixture mutation input present " + label, oldtext in logs[job])
    refused(label + " refused", lambda job=job, oldtext=oldtext, replacement=replacement:
            V["check_logs"]({**logs, job: logs[job].replace(oldtext, replacement)}, oldmerge))
check("all thirteen historical V8 summaries parse", len(V["coverage_v8"]((OLD_CI / "coverage.zip").read_bytes())) == 13)

with ZipFile(OLD_MAC) as archive:
    prefix = "macos-launcher-coverage/"
    data = {n: archive.read(n) for n in archive.namelist() if n.startswith(prefix)}


class SelectedArchive:
    def __init__(self, values): self.values = values
    def read(self, name): return self.values[name]


def reader(values):
    return lambda name: json.loads(values[prefix + name])


read = reader(data)
package = read("package-description.stdout")["path"]
expected = {r["path"]: (r["target"], r["sha256"]) for r in read("production-sources.json")}
check("historical 25-file coverage arithmetic and entry mapping parse", len(expected) == 25 and bool(V["swift_coverage"](read, package, expected)))
check("historical profile outcome format parses", V["swift_profiles"](SelectedArchive(data), prefix, read, package) is None)
count = V["swift_tests"](SelectedArchive(data), prefix, read)
check("historical Swift invocation format and branch witnesses parse", count == 168)

# Concrete F1: failure/misbinding/deletion of existing exporter receipts is invisible.
bad = dict(data)
export_name = prefix + "swift-coverage.json"
export = json.loads(bad[export_name])
export.update(status=1, signal="SIGTERM", error="synthetic failure", args=["--sdk", "macosx", "llvm-cov", "export", "-instr-profile=/stale/wrong.profdata"])
bad[export_name] = json.dumps(export).encode("utf-8")
f1_failed_receipt_accepted = bool(V["swift_coverage"](reader(bad), package, expected))
del bad[export_name]
del bad[prefix + "swift-zero-baseline.json"]
f1_missing_receipts_accepted = bool(V["swift_coverage"](reader(bad), package, expected))
check("F1 failed/misbound and absent export receipts reproduced as accepted", f1_failed_receipt_accepted and f1_missing_receipts_accepted)
findings.append({"id": "N1", "functions": ["swift_coverage", "swift_profiles"], "lines": [344, 398],
    "witness": "The real archived exporter receipt was changed to status1/SIGTERM/error and a wrong profile argument, then coverage and zero exporter receipts were removed. The exact checker still returned its passing coverage totals.",
    "failedMisboundReceiptAccepted": f1_failed_receipt_accepted, "absentReceiptsAccepted": f1_missing_receipts_accepted,
    "scope": "Retained LLVM/profile/export command receipts and their stream hashes/arguments are not checked anywhere on the mac_native path. This is an evidence-validation gap, not a product or current-run failure."})

# Concrete F2: keep only the six required pass witnesses and run boundary events.
events = [json.loads(line) for line in data[prefix + "swift-testing-events.jsonl"].splitlines()]
keep = []
for event in events:
    payload = event["payload"]
    if payload["kind"] in ("runStarted", "runEnded"):
        keep.append(event)
    elif payload["kind"] == "testEnded":
        name = V["re"].sub(r":\d+:\d+$", "", payload["testID"])
        if name in V["BRANCH_TESTS"]:
            keep.append(event)
bad = dict(data)
bad[prefix + "swift-testing-events.jsonl"] = b"".join((json.dumps(e) + "\n").encode("utf-8") for e in keep)
reported = V["swift_tests"](SelectedArchive(bad), prefix, reader(bad))
check("F2 six ended tests with no declarations/starts still report 168", len(keep) == 8 and reported == 168)
findings.append({"id": "N2", "function": "swift_tests", "lines": [410, 424],
    "witness": "From the real168-test event fixture retain only runStarted, six required testEnded/pass events and runEnded; remove every declaration/start/case and other completion. swift_tests still returns168.",
    "originalEvents": len(events), "partialEvents": len(keep), "partialTestEnded": 6, "reportedPassed": reported,
    "scope": "The six branch outcomes remain ordinary named witnesses; the claimed complete native event stream/count is not reconciled. Numeric LLVM branch coverage is not inferred."})

# Top-level final current readback and verified-write ordering are inspected rather than executed.
tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
text = ast.unparse(main)
check("final run PR main readbacks precede last check_run and top-level verified receipt",
      text.index("'run-final.json'") < text.rindex("check_run(") < text.index("record(root, 'verified.json'"))
check("tested ordered parents enforced before artifact work", "[r['sha'] for r in c['parents']] == [args.target, args.head]" in text)
check("tested workflow digest enforced", "digest(source[WORKFLOW]) == WORKFLOW_SHA" in text)
check("hosted native result explicitly denies device GUI acceptance", "'deviceLocalGuiAccepted': False" in ast.unparse(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "mac_native")))
with (O / "offline-findings.json").open("x", encoding="utf-8", newline="\n") as out:
    json.dump({"script": descriptor(SCRIPT), "preparationManifest": descriptor(P / "MANIFEST.sha256.json"),
               "workflow": descriptor(WORKFLOW), "historicalMacFormatFixture": descriptor(OLD_MAC),
               "checks": checks, "count": len(checks), "findings": findings,
               "actualCiGitHubGitNodeProviderOrProductActions": 0, "currentRunAcceptance": False,
               "historicalFixtureReclassifiedCurrent": False}, out, indent=2)
    out.write("\n")
print(json.dumps({"checks": len(checks), "findingsReproduced": len(findings), "actualOperationalActions": 0}))
