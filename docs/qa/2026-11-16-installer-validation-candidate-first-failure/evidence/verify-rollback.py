from hashlib import sha256
from pathlib import Path, PureWindowsPath
import json

HERE = Path(__file__).parent
ARCHIVE = HERE / "rollback-artifact"
MATRIX = HERE / "artifact/qa436-candidate-first-supervisor"
SOURCE_MANIFEST = HERE.parents[1] / "launcher-436-corrected-candidate-source.json"
HOSTED_SEAL = HERE.parents[1] / "launcher-436-rollback-witness-preparation/HOSTED-SHA256SUMS.txt"


def read(path):
    return json.loads(path.read_bytes())


def sha(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    result_file, = ARCHIVE.rglob("launch-result.json")
    root = result_file.parent
    result = read(result_file)
    closure = MATRIX / "binding-after.json"
    pre, post = [root / f"binding-{part}.json" for part in ("before", "after")]
    assert closure.read_bytes() == pre.read_bytes() == post.read_bytes()
    reference = read(root / "admission-reference.json")
    assert reference["matrixClosingSha256"] == sha(closure)
    assert reference["manifestSha256"] == sha(HOSTED_SEAL)
    source_proof = read(SOURCE_MANIFEST)
    installer, = [row for row in source_proof["files"] if row["path"] == "scripts/install-windows-launcher.ps1"]
    assert reference["installerSha256"] == installer["sha256"]
    assert reference["head"] == read(closure)["head"]
    assert reference["tree"] == read(closure)["tree"]
    declarations = read(root / "publisher-source.json")
    assert declarations["installerSha256"] == installer["sha256"]
    assert declarations["declarations"] == {r["function"]: r["sha256"] for r in source_proof["rollback"]}
    assert declarations["publicationOrder"] == ["exe", "config", "desktop", "programs", "pin"]
    assert declarations["lockedDestination"] == "programs"
    child_actual = []
    for label, bound in (("bind-before", 60000), ("seed", 200000), ("observe", 45000), ("bind-after", 60000)):
        attempt, spawn, exit_, close = [read(root / f"{label}.{tag}.json") for tag in ("attempt", "spawn", "exit", "close")]
        assert attempt["deadlineMs"] == bound and attempt["closeMs"] == 10000
        assert spawn["pid"] == exit_["pid"] == close["pid"]
        assert spawn["birthUtc"] == exit_["birthUtc"] < exit_["exitUtc"] < close["closedUtc"]
        assert close["streamsClosed"] and exit_["exitCode"] == 0 and close["stderrBytes"] == 0
        assert all((root / f"{label}.{pipe}").stat().st_size == close[pipe + "Bytes"] for pipe in ("stdout", "stderr"))
        if label in ("seed", "observe"):
            native = read(root / f"{label}-input.json")
            assert native["pid"] == spawn["pid"] and native["birthUtc"] == spawn["birthUtc"]
            assert native["executable"].casefold() == attempt["exe"].casefold()
            assert native["edition"] == "Desktop" and native["powerShell"].startswith("5.1.")
            assert native["thread"] == "STA" and native["scriptSha256"] == installer["sha256"]
            assert native["sourceHead"] == reference["head"]
        child_actual.append({"label": label, "pid": spawn["pid"], "birthUtc": spawn["birthUtc"],
                             "exitUtc": exit_["exitUtc"], "closedUtc": close["closedUtc"]})
    assert read(root / "seed-result.json")["status"] == "public-seed-verified"
    assert "Launcher configured." in (root / "seed.stdout").read_text(encoding="utf-8-sig")
    old, restored = [read(root / f"{label}.json") for label in ("old", "restored")]
    compared = read(root / "restoration-comparison.json")
    assert list(old) == list(restored) == ["exe", "config", "desktop", "programs", "pin", "source"]
    for name, record in old.items():
        lhs = root / "old" / PureWindowsPath(record["copy"]).name
        rhs = root / "restored" / PureWindowsPath(restored[name]["copy"]).name
        assert lhs.read_bytes() == rhs.read_bytes()
        assert sha(lhs) == record["sha256"] == restored[name]["sha256"]
        assert lhs.stat().st_size == record["bytes"] == restored[name]["bytes"]
        assert record["identity"]["Path"] == restored[name]["identity"]["Path"]
        assert record.get("link") == restored[name].get("link")
    assert [item["name"] for item in compared] == list(old)
    assert all(item["bytesEqual"] and item["nativeLinkEqual"] for item in compared)
    changed = read(root / "completed-config-change.json")
    changed_file = root / "changed-config.json.bin"
    assert sha(changed_file) == changed["finalSha256"] != old["config"]["sha256"]
    assert read(changed_file)["Environment"]["GG_LOG_LEVEL"] == changed["logLevel"] == "warn"
    old_configuration = root / "old" / PureWindowsPath(old["config"]["copy"]).name
    assert read(old_configuration)["Environment"]["GG_LOG_LEVEL"] == "info"

    completed = [read(root / f"complete-{index}.json") for index in range(3)]
    composed = read(root / "composed-input.json")
    assert [c["name"] for c in completed] == ["exe", "config", "desktop"]
    assert len(composed) == 5
    last = read(root / "publisher-result.json")
    assert last["completed"] == completed and last["result"] == "restored"
    assert last["delegateCalls"] == 4 and last["heldDuringReturn"]
    for row, staged in zip(completed, composed):
        assert row["op"] == "File.Replace" and row["path"] == staged["Original"]["Path"]
        assert row["finalSha256"].replace("-", "").casefold() == staged["StageDigest"].replace("-", "").casefold()
    locked = read(root / "later-lock.json")
    failure = read(root / "native-failure.json")
    assert locked["handleOpen"] and locked["access"] == locked["share"] == "Read"
    assert locked["identity"] == old["programs"]["identity"]
    assert failure["name"] == "programs" and failure["path"] == locked["path"] == composed[3]["Original"]["Path"]
    assert failure["failure"]["hresult"] == "0x80070020"
    assert completed[0]["completedTick"] < completed[1]["attemptedTick"] <= completed[1]["completedTick"]
    assert changed["tick"] < completed[2]["attemptedTick"] <= completed[2]["completedTick"] < locked["tick"]
    assert locked["tick"] < failure["attemptTick"] <= failure["completedTick"] < last["tick"]
    disposal = read(root / "rollback-result.json")
    assert disposal["status"] == "restored-after-native-sharing-failure" and disposal["lockDisposed"]
    assert disposal["restoredArtifacts"] == 6
    for item in read(root / "stage-remnants.json"):
        binary = root / PureWindowsPath(item["copy"]).name
        assert binary.stat().st_size == item["bytes"] and sha(binary) == item["sha256"]
    assert result["status"] == "rollback-witness-finished-for-review" and result["closingIdentityVerified"]
    assert result["firstFailure"] is None
    print(json.dumps({"scope": "public Windows PowerShell 5.1 seed plus composed production publisher",
                      "bindingSha256": sha(pre), "actualChildren": child_actual,
                      "completedReplacements": completed, "changedConfig": changed, "locked": locked,
                      "realNativeFailure": failure, "publisherDisposition": last["result"],
                      "byteAndNativeMetadataReadback": compared, "lockDisposed": True}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
