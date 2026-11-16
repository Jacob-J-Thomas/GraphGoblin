from collections import Counter
from hashlib import sha256
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).parent


def read(name):
    return json.loads((ROOT / name).read_bytes())


def main():
    job = read("windows-job.json")
    run = read("actions-run.json")
    git = read("git-carrier-readback.json")
    assert run["id"] == job["run_id"] == 43804982239 and run["run_attempt"] == job["run_attempt"] == 1
    assert run["head_sha"] == git["head"] and job["id"] == 133093664323 and job["conclusion"] == "failure"
    conclusions = {step["name"]: step["conclusion"] for step in job["steps"]}
    assert conclusions["Build with #436 run receipt"] == "success"
    assert conclusions["Native Windows launcher acceptance"] == "failure"
    assert conclusions["Admitted #436 hosted installer and process-start observation"] == "skipped"
    assert conclusions["Retain #436 evidence"] == "success"
    assert len(git["paths"]) == 60 and sum(len(x["files"]) for x in git["checkedPackets"]) == 16
    expected_path = "qa436-carrier-43804982239-1/build-exit.json"
    metadata = read("artifact-metadata.json")
    archive = ROOT / "artifact-14198461124.zip"
    assert archive.stat().st_size == metadata["size_in_bytes"] == 628
    assert "sha256:" + sha256(archive.read_bytes()).hexdigest() == metadata["digest"]
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.namelist() == [expected_path]
        assert bundle.read(expected_path) == (ROOT / "artifact" / expected_path).read_bytes()
    build = read("artifact/" + expected_path)
    assert build["exitCode"] == 0 and build["nodeVersion"] == "v22.23.4"
    assert build["beforeIndexSha256"] == build["afterIndexSha256"]
    assert build["head"] == git["merge"] and build["tree"] == git["tree"]
    raw_log = (ROOT / "windows-job.decoded.log").read_bytes()
    assert raw_log == read("windows-log-connector-response.json")["structuredContent"]["content"].encode()
    assert raw_log.startswith(b"\xef\xbb\xbf") and raw_log.endswith(b"\r\n")
    log = raw_log.decode("utf-8")
    assert git["merge"] in log and "Artifact ID 14198461124" in log
    assert all(f"# {line}" in log for line in ["tests 17", "pass 16", "fail 1", "skipped 0"])
    assert "No files were found with the provided path: .tmp/windows-launcher-*/." in log
    runs = [json.loads(line.split("# ", 1)[1]) for line in log.splitlines()
            if '# {"evidence":"independent-api-lock-contention",' in line]
    assert [trial["trial"] for trial in runs] == [1, 2, 3]
    for trial in runs:
        assert Counter(x["status"] for x in trial["results"]) == {"acquired": 1, "refused": 4}
    loser, = [outcome for outcome in runs[2]["results"] if "EPERM:" in outcome.get("error", "")]
    assert loser["pid"] == 952 and loser["status"] == "refused"
    assert "graphgoblin.lock.reclaim" in loser["error"]
    assert "The input did not match the regular expression /another GraphGoblin process holds|Store ownership could not be verified/" in log
    print(json.dumps({"matrix": "skipped", "observedInstallerCases": 0, "nativeSuite": {"passed": 16, "failed": 1},
                      "contention": [{"trial": trial["trial"], "owner": next(x["pid"] for x in trial["results"]
                                                                              if x["status"] == "acquired"), "refused": 4}
                                     for trial in runs], "unexpectedRefusalPid": loser["pid"],
                      "archiveMember": expected_path, "jobLogSha256": sha256(raw_log).hexdigest()}, indent=2))


if __name__ == "__main__":
    main()
