"""Verify a Windows launcher evidence bundle (#496). QA-only; external to the repository.

Accepts the evidence directory or a downloaded artifact ZIP. Checks the exact flat member set,
regular-file members and sizes, absence of canaries and path-like text in every byte, a closed
character set for every observation string value, manifest/result/observation consistency,
and (optionally) reconciles case results with the job's TAP log.

Usage:
  python -I verify-evidence-bundle.py <dir-or-zip> [--tap <native.log>] [--canary <text> ...]
         [--expect-status <status>] [--expect-observations <state>]
Exit 0 when every check passes; prints a JSON report.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import sys
import zipfile

ALLOWED = {"manifest.json", "observations.ndjson", "result.json"}
LIMITS = {"manifest.json": 8 * 1024, "result.json": 16 * 1024, "observations.ndjson": 192 * 1024}
TOTAL = 256 * 1024
TOKEN = re.compile(r"^[A-Za-z0-9_.:\-]{1,64}$")
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
PATHLIKE = re.compile(rb"[A-Za-z]:\\\\|\\\\|/Users/|/home/|\.tmp|AppData|runneradmin|graphgoblin-launcher-alias|\xce\xb1")
CASE_ORDER = ["installer", "launcher", "checkout-alias", "lock-contention", "bounded-logs"]


def members_from(source):
    files, problems = {}, []
    if os.path.isdir(source):
        for name in sorted(os.listdir(source)):
            path = os.path.join(source, name)
            mode = os.lstat(path)
            if stat.S_ISLNK(mode.st_mode) or not stat.S_ISREG(mode.st_mode):
                problems.append(f"{name}: not a regular file")
                continue
            if mode.st_nlink != 1:
                problems.append(f"{name}: {mode.st_nlink} links")
            with open(path, "rb") as handle:
                files[name] = handle.read()
    else:
        with zipfile.ZipFile(source) as archive:
            for info in archive.infolist():
                kind = (info.external_attr >> 16) & 0o170000
                if info.is_dir() or "/" in info.filename or "\\" in info.filename:
                    problems.append(f"{info.filename}: not a flat file member")
                    continue
                if kind and kind != stat.S_IFREG:
                    problems.append(f"{info.filename}: non-regular member type {oct(kind)}")
                files[info.filename] = archive.read(info)
    return files, problems


def verify(source, tap=None, canaries=(), expect_status=None, expect_observations=None):
    files, problems = members_from(source)
    report = {"source": os.path.basename(source), "members": {}}
    if zipfile.is_zipfile(source) if os.path.isfile(source) else False:
        with open(source, "rb") as handle:
            report["archiveSha256"] = hashlib.sha256(handle.read()).hexdigest()
    total = 0
    for name, content in files.items():
        report["members"][name] = {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        total += len(content)
        if name not in ALLOWED:
            problems.append(f"unexpected member {name}")
        elif len(content) > LIMITS[name]:
            problems.append(f"{name} exceeds {LIMITS[name]} bytes")
        for canary in canaries:
            if canary.encode() in content:
                problems.append(f"{name} contains canary {canary[:12]}...")
        match = PATHLIKE.search(content)
        if match:
            problems.append(f"{name} contains path-like text {match.group(0)!r}")
    report["totalBytes"] = total
    if total > TOTAL:
        problems.append("bundle exceeds 256 KiB")
    for required in ("manifest.json", "result.json"):
        if required not in files:
            problems.append(f"missing {required}")
    if problems and ("manifest.json" not in files or "result.json" not in files):
        return {**report, "ok": False, "problems": problems}

    manifest = json.loads(files["manifest.json"])
    result = json.loads(files["result.json"])
    report["status"] = result["status"]
    report["steps"] = result["steps"]
    report["observationState"] = result["observations"]["state"]
    report["missing"] = result["missing"]
    report["binding"] = {k: manifest["binding"].get(k) for k in (
        "repository", "workflowRef", "job", "runId", "runAttempt", "event", "ref", "sha",
        "eventHead", "eventBase", "imageVersion", "node", "unavailable")}
    report["checkout"] = manifest["binding"].get("checkout")
    if manifest.get("schema") != "graphgoblin.windows-launcher-evidence/1":
        problems.append("manifest schema")
    if manifest.get("evidenceId") != result.get("evidenceId"):
        problems.append("manifest and result evidence IDs differ")
    uploaded = set(result["uploaded"])
    if uploaded != set(files):
        problems.append(f"members {sorted(files)} differ from result.uploaded {sorted(uploaded)}")
    if expect_status and result["status"] != expect_status:
        problems.append(f"status {result['status']} != {expect_status}")
    if expect_observations and result["observations"]["state"] != expect_observations:
        problems.append(f"observations {result['observations']['state']} != {expect_observations}")

    records = []
    if "observations.ndjson" in files:
        text = files["observations.ndjson"].decode("utf-8")
        for number, line in enumerate(text.splitlines(), 1):
            record = json.loads(line)
            records.append(record)
            for key, value in record.items():
                if key == "at":
                    if not TIMESTAMP.match(value):
                        problems.append(f"line {number}: timestamp shape")
                elif isinstance(value, str) and not TOKEN.match(value):
                    problems.append(f"line {number}: {key} value outside the closed character set")
                elif not isinstance(value, (str, int, bool, type(None))):
                    problems.append(f"line {number}: {key} is not a scalar")
        if records and records[0].get("evidenceId") != manifest["evidenceId"]:
            problems.append("observations are not bound to the manifest")
        if len(records) != result["observations"]["records"]:
            problems.append("result record count differs from the file")
        types = {}
        for record in records:
            types[record["type"]] = types.get(record["type"], 0) + 1
        report["recordTypes"] = types
        report["children"] = [
            {k: r[k] for k in ("case", "subtest", "child", "tool", "mode", "outcome", "exitCode",
                               "errorCode", "signal", "killed", "elapsedMs", "stdoutBytes",
                               "stderrBytes", "diagnostic")}
            for r in records if r["type"] == "child" and r["outcome"] != "exit-zero"]
        report["aliases"] = [r for r in records if r["type"] in ("alias", "alias-round")]
        report["fixtureStates"] = [r for r in records if r["type"] == "fixture-state"]
        report["caseEnds"] = [
            [r["case"], r["subtest"], r["result"], r["failureKind"], r["failureExit"], r["failureCode"]]
            for r in records if r["type"] == "case-end"]
        closed = [r for r in records if r["type"] == "recorder-closed"]
        report["closed"] = closed[0] if closed else None

    if tap:
        with open(tap, encoding="utf-8", errors="replace") as handle:
            log = handle.read()
        top = re.findall(r"^(ok|not ok) (\d+) - ", log, re.M)
        report["tapTop"] = top
        for status, number in top:
            name = CASE_ORDER[int(number) - 1]
            recorded = result["cases"][name]["result"]
            expected = "pass" if status == "ok" else "fail"
            if recorded is not None and recorded != expected:
                problems.append(f"case {name}: TAP {status} but evidence {recorded}")
        markers = [json.loads(m) for m in re.findall(r'(\{"evidence":"windows-launcher-observation".*\})', log)]
        by_seq = {r["seq"]: r for r in records}
        for marker in markers:
            marker = {k: v for k, v in marker.items() if k != "evidence"}
            if marker["seq"] in by_seq and by_seq[marker["seq"]] != marker:
                problems.append(f"stdout marker {marker['seq']} differs from the archived record")
        report["stdoutMarkers"] = len(markers)
    return {**report, "ok": not problems, "problems": problems}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--tap")
    parser.add_argument("--canary", action="append", default=[])
    parser.add_argument("--expect-status")
    parser.add_argument("--expect-observations")
    args = parser.parse_args()
    outcome = verify(args.source, args.tap, args.canary, args.expect_status, args.expect_observations)
    print(json.dumps(outcome, indent=2))
    sys.exit(0 if outcome["ok"] else 1)
