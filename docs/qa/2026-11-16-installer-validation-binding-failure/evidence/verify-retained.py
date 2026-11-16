from hashlib import sha256
from pathlib import Path, PureWindowsPath
import json
import os
import subprocess
import zipfile

ROOT = Path(__file__).parent
ARTIFACT = ROOT / "artifact"
SUPERVISOR = ARTIFACT / "qa436-baseline-corrected-supervisor"
CONTROL = ARTIFACT / "qa436-carrier-43803466920-1"
BASE = "be633141be5a0cd2b4f960a46761fabbf2cb82c7"
CARRIER = "f0e1f75ad81e83605dfdcb19f6745cf4aa3d6877"
MERGE = "463e96b69de23f569bb1c8599860b3d804cf6874"
TREE = "1bf191aee4851996888935ca982ce973a2cd2f8f"
V1 = "6b4be7674b608a8583415dd75e642d483249d789eca678e14b641af958918926"
V2 = "ea5250650dc7f7b7815dd88c20476c50931ef29ae93467da1169c930aab47c1a"
EXECUTION_V2 = "310225e74d3f43a601eed73f5fcfda7d7458dbe9a0d073b0a9bd47f1fcffd679"


def read(path):
    return json.loads(path.read_bytes())


def sha(payload):
    return sha256(payload).hexdigest()


def main():
    checkout = (Path.home() / ".codex/worktrees/gg-20261115-runtime/GraphGoblin").resolve(strict=True)

    def git(*args):
        env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
        return subprocess.check_output(["git", "-C", str(checkout), *args], env=env)

    merge = read(ROOT / "checkout-merge.json")
    assert merge["sha"] == MERGE and merge["tree"]["sha"] == TREE
    assert [p["sha"] for p in merge["parents"]] == [BASE, CARRIER]
    run = read(ROOT / "actions-run.json")
    job = read(ROOT / "windows-job.json")
    assert run["id"] == job["run_id"] == 43803466920 and run["run_attempt"] == job["run_attempt"] == 1
    assert run["head_sha"] == CARRIER and job["id"] == 133088873299
    assert job["conclusion"] == "failure"
    failed = [s["name"] for s in job["steps"] if s["conclusion"] == "failure"]
    assert failed == ["Admitted #436 hosted installer and process-start observation"]
    archive = ROOT / "artifact-14196599189.zip"
    metadata = read(ROOT / "artifact-metadata.json")
    assert archive.stat().st_size == metadata["size_in_bytes"] == 5798
    assert "sha256:" + sha(archive.read_bytes()) == metadata["digest"]
    with zipfile.ZipFile(archive) as zip_file:
        names = set(zip_file.namelist())
        actual = {p.relative_to(ARTIFACT).as_posix() for p in ARTIFACT.rglob("*") if p.is_file()}
        assert names == actual and len(names) == 10
        assert all(zip_file.read(name) == (ARTIFACT / name).read_bytes() for name in names)
    admission_path, build_path = [CONTROL / name for name in ("admission.json", "build-exit.json")]
    admission, build = read(admission_path), read(build_path)
    assert admission["state"] == "root-admitted" and admission["evidenceName"] == "qa436-baseline-corrected"
    assert admission["expectedCommit"] == build["head"] == MERGE and admission["expectedTree"] == build["tree"] == TREE
    assert admission["baseCommit"] == admission["productCommit"] == BASE
    assert build["exitCode"] == 0 and build["nodeVersion"] == "v22.23.4"
    assert build["beforeIndexSha256"] == build["afterIndexSha256"]
    assert sha(build_path.read_bytes()) == admission["buildReceipt"]["sha256"]
    assert admission["driverManifestSha256"] == V2 and admission["packetManifestSha256"] == EXECUTION_V2
    paths = set(git("diff", "--name-only", BASE, CARRIER).decode().splitlines())
    assert paths == set(admission["carrierOnlyPaths"]) and len(paths) == 48
    root_admission = read(ROOT / "../436-corrected-baseline-preparation-root-admission.json")
    assert sha(git("cat-file", "blob", CARRIER + ":.github/workflows/ci.yml")) == root_admission["workflowSha256"]
    packet_folders = (("native", V2, "launcher-436-native-v2-preparation"),
                      ("execution", EXECUTION_V2, "launcher-436-execution-v2-preparation"))
    for role, expected, folder in packet_folders:
        directory = ROOT.parents[1] / folder
        manifest = (directory / "SHA256SUMS.txt").read_bytes()
        archive_prefix = f"{CARRIER}:docs/qa/2026-11-16-installer-validation-preparation/raw/{role}-v2/"
        assert sha(manifest) == expected
        assert manifest == git("cat-file", "blob", archive_prefix + "SHA256SUMS.txt")
        for line in manifest.decode().splitlines():
            digest, name = line.split(None, 1)
            archived_name = "README.md.txt" if name == "README.md" else name
            body = (directory / name).read_bytes()
            assert sha(body) == digest and body == git("cat-file", "blob", archive_prefix + archived_name)
    binder = ROOT.parents[1] / "launcher-436-execution-v2-preparation/bind.mjs"
    lines = binder.read_text().splitlines()
    assert f"const driverSeal = '{V1}';" in lines
    assert lines[66] == "assert.equal(input.driverManifestSha256, driverSeal);"
    assert lines[67].lstrip().startswith("const packetProof")
    assert lines[68].lstrip().startswith("const driverProof")
    attempt, spawn, exit_, close = [read(SUPERVISOR / f"bind-before.{name}.json")
                                     for name in ("attempt", "spawn", "exit", "close")]
    assert attempt["arguments"] == spawn["arguments"] and spawn["executable"] == build["nodePath"]
    assert sha(admission_path.read_bytes()) == attempt["arguments"][2]
    assert PureWindowsPath(attempt["arguments"][0]).name == "bind.mjs"
    assert spawn["pid"] == exit_["pid"] == close["pid"] == 1584
    assert spawn["birthUtc"] == exit_["birthUtc"] < exit_["exitUtc"] < close["closedUtc"]
    assert exit_["exitCode"] == close["exitCode"] == 1 and close["streamsClosed"]
    stderr_path = SUPERVISOR / "bind-before.stderr"
    raw = stderr_path.read_bytes()
    assert b"AssertionError [ERR_ASSERTION]" in raw and b"bind.mjs:67:8" in raw
    assert V2.encode() in raw and V1.encode() in raw and b"Node.js v22.23.4" in raw
    assert close["stderrBytes"] == len(raw) == 683
    assert close["stdoutBytes"] == 0 and (SUPERVISOR / "bind-before.stdout").read_bytes() == b""
    result = read(SUPERVISOR / "launch-result.json")
    assert result["status"] == "incomplete" and result["head"] == MERGE
    assert result["nativeDriver"] is None and result["caseCount"] is None
    assert not result["closingIdentityVerified"] and result["processWitness"] == "incomplete"
    assert result["firstFailure"] == read(SUPERVISOR / "first-failure.json")
    decoded = (ROOT / "windows-job.decoded.log").read_bytes()
    capture = read(ROOT / "windows-log-connector-response.json")
    assert decoded == capture["structuredContent"]["content"].encode()
    assert decoded.startswith(b"\xef\xbb\xbf") and decoded.endswith(b"\r\n")
    assert b"# tests 17" in decoded and b"# pass 17" in decoded and b"# fail 0" in decoded
    assert MERGE.encode() in decoded and b"Artifact ID 14196599189" in decoded
    print(json.dumps({"disposition": "preflight failed before native driver or ETW",
                      "head": MERGE, "tree": TREE, "parentCommits": [BASE, CARRIER],
                      "verifiedCarrierPaths": len(paths), "verifiedRawPacketFiles": 18,
                      "admissionSha256": sha(admission_path.read_bytes()), "buildReceiptSha256": sha(build_path.read_bytes()),
                      "retainedArchiveSha256": sha(archive.read_bytes()), "jobLogSha256": sha(decoded),
                      "binderActualExit": exit_, "binderSeparateClose": close,
                      "configuredDriverSha256": V2, "staleBinderDriverSha256": V1,
                      "runtimeArtifactBindingCompleted": False, "installerCasesObserved": 0}, indent=2))


if __name__ == "__main__":
    main()
