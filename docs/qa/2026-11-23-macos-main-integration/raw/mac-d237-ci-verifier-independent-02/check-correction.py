"""Focused N1/N2 regression using historical format bytes and pure mutations only."""
import ast
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from runpy import run_path
from zipfile import ZIP_DEFLATED, ZipFile

O = Path(__file__).resolve().parent
E = O.parent
P = E / "mac-d237-ci-verifier-preparation-02"
OLD = E / "mac-d237-ci-verifier-preparation-01"
ENTRY = P / "verify-mac-ci.py"
ARCHIVE = Path("C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher/macos-pr501-ci-14/artifacts/macos-launcher-14362060639.zip")
checks = []


def descriptor(path):
    data = path.read_bytes()
    return {"source": str(path), "bytes": len(data), "sha256": sha256(data).hexdigest()}


def check(label, ok):
    if not ok:
        raise AssertionError(label)
    checks.append(label)


def refused(label, operation):
    try:
        operation()
    except (ValueError, KeyError, TypeError):
        checks.append(label)
        return
    raise AssertionError(label)


check("exact correction script", descriptor(ENTRY)["sha256"] == "cdf140f4db3ff4746a6b77c466c5c801a7a288b3942e62b69599bc05efd7af75")
check("exact correction manifest", descriptor(P / "MANIFEST.sha256.json")["sha256"] == "2c521fc9c5fc191b12a7b146599d7bb3061fe55c6dd71912101be793848f126a")
check("original script unchanged", descriptor(OLD / "verify-mac-ci.py")["sha256"] == "62798ef7491847f6ee9c8699825ba7e200f4b859100680780cd0dc3ffee3f9bb")
check("original refusal unchanged", descriptor(E / "mac-d237-ci-verifier-independent-01/REFUSAL.json")["sha256"] == "67a363da8f7867752552bc7350446bb3787f1bc84a8104466aebc856c83e8711")
manifest = json.loads((P / "MANIFEST.sha256.json").read_bytes())
for name, expected in manifest["files"].items():
    actual = descriptor(P / name)
    check("member " + name, actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"])
check("four exact preparation members", {p.name for p in P.iterdir() if p.is_file()} == set(manifest["files"]) | {"MANIFEST.sha256.json"})
old_ast = ast.parse((OLD / "verify-mac-ci.py").read_text(encoding="utf-8"))
new_ast = ast.parse(ENTRY.read_text(encoding="utf-8"))
old_functions = {n.name: n for n in old_ast.body if isinstance(n, ast.FunctionDef)}
new_functions = {n.name: n for n in new_ast.body if isinstance(n, ast.FunctionDef)}
same = sorted(n for n in old_functions if ast.dump(old_functions[n], include_attributes=False) == ast.dump(new_functions[n], include_attributes=False))
changed = sorted(old_functions.keys() - set(same))
added = sorted(new_functions.keys() - old_functions.keys())
check("only three declared existing functions changed", changed == ["mac_native", "swift_profiles", "swift_tests"])
check("27 existing functions AST-identical including main Windows current-run coverage", len(same) == 27 and {"main", "windows_native", "swift_coverage", "check_run", "check_jobs", "archive", "blobs"} <= set(same))
check("only four focused helper functions added", added == ["path_witnesses", "swift_case", "swift_command", "swift_event_roster"])
old_assign = [ast.dump(n, include_attributes=False) for n in old_ast.body if isinstance(n, ast.Assign)]
new_assign = [ast.dump(n, include_attributes=False) for n in new_ast.body if isinstance(n, ast.Assign)]
check("all workflow source scope and replay constants unchanged", old_assign == new_assign)
check("explicit require guards survive optimized Python", not any(isinstance(n, ast.Assert) for n in ast.walk(new_ast)))

old = run_path(str(OLD / "verify-mac-ci.py"), run_name="offline_original_definitions")
new = run_path(str(ENTRY), run_name="offline_correction_definitions")


def operational_trap(*args, **kwargs):
    raise AssertionError("Operational dependency called")


for ns in (old, new):
    ns["get"].__globals__["get"] = operational_trap
    ns["subprocess"].check_output = operational_trap
raw = ARCHIVE.read_bytes()
with ZipFile(BytesIO(raw)) as z:
    data = {name: z.read(name) for name in z.namelist()}
prefix = "macos-launcher-coverage/"
package = json.loads(data[prefix + "package-description.stdout"])["path"]
expected = {r["path"]: (r["target"], r["sha256"]) for r in json.loads(data[prefix + "production-sources.json"])}


def format_inventory(z, selected_prefix, unbound_sources):
    # Deliberate fixture-only inventory substitute avoids reading any product Swift source.
    # The exact inventory function is AST-identical and was separately reviewed in independent-01.
    check_prefix = selected_prefix == prefix
    if not check_prefix:
        raise AssertionError("Unexpected fixture inventory prefix")
    return lambda name: json.loads(z.read(prefix + name)), package, expected


for ns in (old, new):
    ns["mac_native"].__globals__["swift_inventory"] = format_inventory
versions = data["macos-launcher-toolchain/versions.txt"].decode("utf-8").splitlines()
merge, tree = versions[:2]
driver_sha = json.loads(data["macos-launcher-acceptance/manifest.json"])["binding"]["driver"]
# Real fixture driver bytes are unnecessary for this known-unchanged installer check.
# Use a digest-only stub only for this one hash operation, preserving all other installer conditions.
driver = object()
for ns in (old, new):
    original_digest = ns["digest"]
    ns["mac_native"].__globals__["digest"] = lambda value, original_digest=original_digest: driver_sha if value is driver else original_digest(value)


def archive_of(values):
    result = BytesIO()
    with ZipFile(result, "w", compression=ZIP_DEFLATED) as z:
        for name, body in values.items():
            z.writestr(name, body)
    return result.getvalue()


def verify(ns, values):
    return ns["mac_native"](archive_of(values), merge, tree, {}, driver)


check("actual changed hosted orchestration accepts historical format only", verify(new, data)["testsPassed"] == 168)
check("historical role remains hosted not GUI", verify(new, data)["deviceLocalGuiAccepted"] is False)

bad = dict(data)
receipt = json.loads(bad[prefix + "swift-coverage.json"])
receipt.update(status=1, signal="SIGTERM", error="synthetic failure", args=["--sdk", "macosx", "llvm-cov", "export", "-instr-profile=/stale/wrong.profdata"])
bad[prefix + "swift-coverage.json"] = json.dumps(receipt).encode()
check("original N1 failed misbound receipt accepts in old orchestration", verify(old, bad)["testsPassed"] == 168)
refused("N1 failed misbound receipt rejected by new orchestration", lambda: verify(new, bad))
bad = dict(data)
del bad[prefix + "swift-coverage.json"]
del bad[prefix + "swift-zero-baseline.json"]
check("original N1 absent receipts accept in old orchestration", verify(old, bad)["testsPassed"] == 168)
refused("N1 absent receipts rejected by new orchestration", lambda: verify(new, bad))
events = [json.loads(line) for line in data[prefix + "swift-testing-events.jsonl"].splitlines()]
partial = [e for e in events if e["payload"]["kind"] in ("runStarted", "runEnded") or
           e["payload"]["kind"] == "testEnded" and new["re"].sub(r":\d+:\d+$", "", e["payload"]["testID"]) in new["BRANCH_TESTS"]]
bad = dict(data)
bad[prefix + "swift-testing-events.jsonl"] = b"".join((json.dumps(e) + "\n").encode() for e in partial)
check("original N2 eight-event partial fixture still accepts old count168", len(partial) == 8 and verify(old, bad)["testsPassed"] == 168)
refused("N2 eight-event fixture rejected in new orchestration", lambda: verify(new, bad))

for label, mutation in [
    ("export stdout stale digest", lambda d: d.__setitem__(prefix + "swift-coverage.stdout", d[prefix + "swift-coverage.stdout"] + b" ")),
    ("zero export stdout stale digest", lambda d: d.__setitem__(prefix + "swift-zero-baseline.stdout", d[prefix + "swift-zero-baseline.stdout"] + b" ")),
    ("merge stdout stale digest", lambda d: d.__setitem__(prefix + "swift-coverage-profile.stdout", b"unexpected")),
]:
    bad = dict(data)
    mutation(bad)
    refused(label + " rejected", lambda bad=bad: verify(new, bad))

for label, key, value in [("swift-coverage", "cwd", "/wrong/scratch"), ("swift-zero-profile", "status", False),
                          ("presentation-fixture-profile", "signal", "SIGTERM"), ("swift-tests", "timeout", 1)]:
    bad = dict(data)
    rec = json.loads(bad[prefix + label + ".json"])
    rec[key] = value
    bad[prefix + label + ".json"] = json.dumps(rec).encode()
    refused(label + " malformed " + key + " rejected", lambda bad=bad: verify(new, bad))

# Pure roster semantics, including opaque duplicate case IDs and concurrent case order.
def declaration(kind, identity, **extra):
    return {"version": 0, "kind": "test", "payload": {"kind": kind, "id": identity, **extra}}


def event(kind, testid=None, **extra):
    return {"version": 0, "kind": "event", "payload": {"kind": kind, **({"testID": testid} if testid else {}), **extra}}


suite, function = "Suite", "Suite/case()/Case.swift:1:1"
case_a = {"id": "opaque-reused", "displayName": "A"}
case_b = {"id": "opaque-reused", "displayName": "B"}
roster = [declaration("suite", suite), declaration("function", function, isParameterized=True, _testCases=[case_a, case_b]),
          event("runStarted"), event("testStarted", suite), event("testStarted", function),
          event("testCaseStarted", function, _testCase=case_a), event("testCaseStarted", function, _testCase=case_b),
          event("testCaseEnded", function, _testCase=case_b), event("testCaseEnded", function, _testCase=case_a),
          event("testEnded", function, messages=[{"symbol": "pass"}]), event("testEnded", suite, messages=[{"symbol": "pass"}]), event("runEnded")]
check("two opaque same-ID cases distinguished by display name and interleaving accept", new["swift_event_roster"](roster, 1) == {"Suite/case()/Case.swift"})
refused("suite does not add to function count", lambda: new["swift_event_roster"](roster, 2))
for label, edit in [
    ("balanced omitted case", lambda rows: [r for r in rows if r["payload"].get("_testCase") != case_a]),
    ("case end before start", lambda rows: rows[:5] + [rows[8]] + rows[5:8] + rows[9:]),
    ("missing function end", lambda rows: rows[:9] + rows[10:]),
    ("duplicate function declaration", lambda rows: rows[:2] + [deepcopy(rows[1])] + rows[2:]),
    ("duplicate run start", lambda rows: rows[:3] + [event("runStarted")] + rows[3:]),
    ("undeclared case", lambda rows: rows[:5] + [event("testCaseStarted", function, _testCase={"id": "other", "displayName": "C"})] + rows[5:]),
    ("suite ends before child", lambda rows: rows[:9] + [rows[10], rows[9], rows[11]]),
]:
    refused(label + " rejects", lambda edit=edit: new["swift_event_roster"](edit(deepcopy(roster)), 1))
identical = deepcopy(roster)
identical[1]["payload"]["_testCases"][1] = deepcopy(case_a)
identical[6]["payload"]["_testCase"] = deepcopy(case_a)
identical[7]["payload"]["_testCase"] = deepcopy(case_a)
check("identical opaque ID/display case multiplicity reconciles as multiset", bool(new["swift_event_roster"](identical, 1)))

main_text = ast.unparse(new_functions["main"])
native_text = ast.unparse(new_functions["mac_native"])
check("native receipt and complete tests checked before coverage acceptance", native_text.index("swift_tests(") < native_text.index("swift_profiles(") < native_text.index("swift_coverage("))
check("strict final current readback remains before verified receipt", main_text.index("'run-final.json'") < main_text.rindex("check_run(") < main_text.index("record(root, 'verified.json'"))
readme = (P / "README.md").read_text(encoding="utf-8")
check("unretained input binaries remain explicit hosted-witness limit", "does not retain each input binary" in readme
      and "performs no signed-attestation verification" in readme)
with (O / "correction-controls.json").open("x", encoding="utf-8", newline="\n") as out:
    json.dump({"script": descriptor(ENTRY), "preparationManifest": descriptor(P / "MANIFEST.sha256.json"),
               "historicalFormatFixture": descriptor(ARCHIVE), "checks": checks, "count": len(checks),
               "changedFunctions": changed, "addedFunctions": added, "unchangedFunctions": same,
               "N1": "original accepted / corrected refused", "N2": "original accepted / corrected refused",
               "fixtureInventorySubstituted": True, "installerDriverDigestSubstitutedForFixtureOnly": True,
               "actualGitSourceBytesRead": False, "actualCiGitHubGitNodeProviderOrProductActions": 0,
               "currentRunAcceptance": False, "rawProfileInputsCryptographicallyReplayed": False}, out, indent=2)
    out.write("\n")
print(json.dumps({"checks": len(checks), "passed": True, "N1N2Cleared": True, "actualOperationalActions": 0}))
