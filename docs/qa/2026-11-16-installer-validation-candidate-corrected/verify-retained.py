from collections import Counter
from decimal import Decimal
from hashlib import sha256
from pathlib import Path, PureWindowsPath
import json
import re
from xml.etree import ElementTree as ET

ROOT = Path(__file__).parent
ARTIFACT = ROOT / "artifact"
SUPERVISOR = ARTIFACT / "qa436-candidate-corrected-supervisor"
EVIDENCE = ARTIFACT / "qa436-candidate-corrected/evidence"
CONTROL = ARTIFACT / "qa436-carrier-43823828028-1"
BATCH = ROOT.parents[1]
SYSTEM_GUID = "9e814aad-3204-11d2-9a82-006008a86939"
PROCESS_GUID = "3d6fa8d0-fe05-11d0-9dda-00c04fd7ba7c"


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def audit_identity():
    attempt = read(ROOT / "actions-attempt1.json")
    job = read(ROOT / "windows-job.json")
    merge = read(ROOT / "checkout-merge.json")
    assert attempt["id"] == job["run_id"] == 43823828028 and attempt["run_attempt"] == job["run_attempt"] == 1
    assert job["id"] == 133152816074 and attempt["head_sha"] == merge["parents"][1]["sha"]
    admission = read(CONTROL / "admission.json")
    build = read(CONTROL / "build-exit.json")
    assert build["head"] == admission["expectedCommit"] == merge["sha"]
    assert build["tree"] == admission["expectedTree"] == merge["tree"]["sha"]
    proof = read(ROOT / "git-carrier-readback.json")
    assert admission["baseCommit"] == merge["parents"][0]["sha"] == proof["base"]
    assert admission["productCommit"] == proof["product"] != admission["baseCommit"]
    assert admission["productTree"] == proof["productTree"]
    assert admission["phase"] == "candidate" and admission["validatorArgument"] == "--validate-install"
    assert set(admission["carrierOnlyPaths"]) == set(proof["carrierPaths"])
    assert build["exitCode"] == 0 and build["nodeVersion"] == "v22.23.4"
    assert build["githubRunAttempt"] == admission["githubRunAttempt"] == "1"
    assert build["beforeIndexSha256"] == build["afterIndexSha256"]
    assert digest(CONTROL / "build-exit.json") == admission["buildReceipt"]["sha256"]
    result = {"checkedHead": merge["sha"], "checkedTree": merge["tree"]["sha"], "carrierPaths": len(admission["carrierOnlyPaths"])}
    before_path, after_path = [SUPERVISOR / f"binding-{part}.json" for part in ("before", "after")]
    if not before_path.exists():
        return result | {"preBindingPresent": False}
    before = read(before_path)
    assert before["head"] == merge["sha"] and before["tree"] == merge["tree"]["sha"]
    assert before["index"]["sha256"] == build["afterIndexSha256"]
    assert before["admission"]["sha256"] == digest(CONTROL / "admission.json")
    for key, seal_field, folder in (("driver", "driverManifestSha256", "launcher-436-candidate-budget-preparation/native"),
                                    ("packet", "packetManifestSha256", "launcher-436-candidate-budget-preparation/execution")):
        manifest = BATCH / folder / "SHA256SUMS.txt"
        assert digest(manifest) == admission[seal_field] == before[key]["manifest"]["sha256"]
        manifest_files = dict(line.split(None, 1)[::-1] for line in manifest.read_text().splitlines())
        assert manifest_files.keys() == before[key]["files"].keys()
        for name, sha in manifest_files.items():
            assert sha == digest(manifest.parent / name) == before[key]["files"][name]["sha256"]
    driver_before, driver_after = [EVIDENCE / p for p in ("binding.json", "post-binding.json")]
    return result | {"preBindingPresent": True, "bindingSha256": digest(before_path),
                     "identicalOuterBindings": after_path.exists() and before_path.read_bytes() == after_path.read_bytes(),
                     "driverPreBinding": driver_before.exists(), "driverPostBinding": driver_after.exists(),
                     "identicalDriverFileBindings": driver_after.exists() and read(driver_after) == read(driver_before)["files"],
                     "sourceCount": before["sourceCount"], "sourceInventorySha256": before["sourceInventorySha256"],
                     "artifactCounts": before["artifacts"]["counts"]}


def direct_children(folder):
    pids = []
    for attempt in sorted(folder.rglob("*.attempt.json")):
        name = attempt.name.removesuffix(".attempt.json")
        def current(suffix):
            return attempt.with_name(name + "." + suffix)
        raw = {kind: read(current(kind + ".json")) for kind in ("spawn", "exit", "close") if current(kind + ".json").exists()}
        birth, exit_, close = (raw.get(key) for key in ("spawn", "exit", "close"))
        if exit_:
            assert birth and birth["pid"] == exit_["pid"]
            birth_key = "birthUtc" if "birthUtc" in birth else "startedUtc"
            assert birth[birth_key] == exit_[birth_key]
        if close:
            assert exit_ and close["pid"] == exit_["pid"] and close["exitCode"] == exit_["exitCode"]
            assert close["streamsClosed"]
            assert all(current(pipe).stat().st_size == close[pipe + "Bytes"] for pipe in ("stdout", "stderr"))
        pids.append({"name": attempt.relative_to(folder).as_posix().removesuffix(".attempt.json"), "receipts": raw,
                     "timeout": current("timeout.json").exists(), "deadline": read(attempt).get("timeoutMs")})
    return pids


def signature(record):
    return record["kind"], record.get("sha256"), record.get("bytes")


def verify_matrix(summary):
    results = {case["case"]: case for case in summary["cases"]}
    assert len(results) == len(summary["cases"])
    cases = []
    for number in range(1, 33):
        case_id = f"{number:02}"
        folder = EVIDENCE / case_id
        result = results.get(case_id)
        row = {"id": case_id, "status": result["status"] if result else "unobserved", "snapshots": [], "archivedFileChecks": 0}
        if folder.exists() and not result:
            row["status"] = "started-without-disposition"
        if result:
            receipt = folder / "result.json"
            if not receipt.exists():
                assert case_id == "31" and result["status"] == "unavailable"
                receipt = EVIDENCE / "31-unavailable.json"
            assert read(receipt) == result
            for prop in ("mutation", "problems", "availability", "existingInstall"):
                if prop in result:
                    row[prop] = result[prop]
        stages = {}
        for stage in ("before", "after"):
            path = folder / f"{stage}.json"
            if not path.exists():
                continue
            state = read(path)
            stages[stage] = state
            copies = folder / f"{stage}-files"
            if copies.exists():
                expected = {key + PureWindowsPath(data["path"]).suffix: data
                            for key, data in state.items() if data["kind"] == "file"}
                assert set(expected) == {file.name for file in copies.iterdir()}
                for name, data in expected.items():
                    body = copies / name
                    assert body.stat().st_size == data["bytes"] and digest(body) == data["sha256"]
                    row["archivedFileChecks"] += 1
            row["snapshots"].append(stage)
        if before := stages.get("before"):
            source = before["source"]
            assert PureWindowsPath(source["path"]).name == "Chrome α.lnk"
            assert source["identity"]["Path"] == source["path"]
            link = source["link"]
            assert PureWindowsPath(link["target"]).name.lower() == "chrome_proxy.exe" and "--profile-directory=" in link["arguments"]
            assert link["appId"] == "GraphGoblin.QA436.Source" and re.search(r"--app-id=[a-p]{32}$", link["arguments"])
            row["unicodeSource"] = source["path"]
            if "sourceAlias" in before:
                alias = before["sourceAlias"]
                assert all(alias["identity"][part] == source["identity"][part] for part in ("Volume", "FileId"))
                assert alias["sha256"] == source["sha256"]
                row["nativeAlias"] = {"spelling": alias["path"], "identity": alias["identity"]}
        if before and (after := stages.get("after")):
            differences = [key for key in before if signature(before[key]) != signature(after[key])]
            row["changedBytesOrPresence"] = differences
            row["identityChanges"] = [key for key in before if before[key].get("identity") != after[key].get("identity")]
            if result:
                assert differences == result["changed"]
        exit_file = folder / "installer.exit.json"
        if exit_file.exists():
            row["exitCode"] = read(exit_file)["exitCode"]
            diagnostic = (folder / "installer.stderr").read_bytes().decode("utf-8-sig", errors="replace").splitlines()
            row["stderrFirstLine"] = diagnostic[0] if diagnostic else ""
            if result:
                assert row["exitCode"] == result["process"]["exitCode"]
                row["portListeningAfter"] = result["process"]["portListeningAfter"]
        cases.append(row)
    return cases


def inspect_trace():
    trace = SUPERVISOR / "process-start.xml"
    if not trace.exists():
        return {"rawXmlPresent": False}
    start_end = []
    opcodes = Counter()
    version_counts = Counter()
    for ordinal, record in enumerate(ET.parse(trace).getroot().findall(".//{*}Event"), 1):
        system = record.find("{*}System")
        if system is None:
            continue
        provider = system.find("{*}Provider")
        g = record.findtext("{*}ExtendedTracingInfo/{*}EventGuid", "").strip("{}").lower()
        if provider is None or provider.get("Guid", "").strip("{}").lower() != SYSTEM_GUID or g != PROCESS_GUID:
            continue
        opcode = system.findtext("{*}Opcode")
        opcodes[opcode] += 1
        if opcode not in ("1", "2"):
            continue
        version_counts[system.findtext("{*}Version")] += 1
        payload = {node.get("Name"): node.text for node in record.findall("./{*}EventData/{*}Data")}
        start_end.append({"ordinal": ordinal, "opcode": opcode, "time": system.find("{*}TimeCreated").get("SystemTime"),
                          "pid": int(payload["ProcessId"], 0), "parent": int(payload["ParentId"], 0),
                          "processKey": payload["UniqueProcessKey"], "image": payload.get("ImageFileName"),
                          "commandLine": payload.get("CommandLine")})
    etl = SUPERVISOR / "process-start.etl"
    base = {"rawXmlPresent": True, "opcodeCounts": opcodes, "startEndVersions": version_counts, "etlBytes": etl.stat().st_size}
    stop_file = SUPERVISOR / "observer-stop.json"
    if stop_file.exists():
        stop = read(stop_file)
        initial = read(SUPERVISOR / "observer-initial-query.json")
        assert stop["Name"] == initial["Name"] and stop["SessionGuid"] == initial["SessionGuid"]
        assert initial["EnabledFlags"] & 1
        base.update({"loss": [stop[k] for k in ("EventsLost", "LogBuffersLost", "RealTimeBuffersLost")],
                     "stopStatus": stop["Status"], "session": stop["Name"], "buffers": stop["BuffersWritten"]})
    summary = SUPERVISOR / "observer-summary.json"
    if not summary.exists():
        return base
    observer = read(summary)
    assert observer["systemTraceProviderGuid"] == SYSTEM_GUID and observer["classicProcessEventGuid"] == PROCESS_GUID
    assert observer["decodedStarts"] == opcodes["1"]
    assert observer["decodedVersions"] == ["4"] and version_counts.keys() == {"4"}
    before, after = observer["canaries"]
    assert before["time"] < observer["driver"]["time"] < observer["driverClose"]["closedUtc"] < after["time"]
    raw_by_ordinal = {event["ordinal"]: event for event in start_end}
    def confirm(start):
        raw = raw_by_ordinal[start["ordinal"]]
        assert raw["opcode"] == "1"
        assert all(raw[k] == start[k] for k in ("pid", "parent", "image", "commandLine"))
        return raw
    early, late = confirm(before), confirm(after)
    confirmed = [confirm(start) for start in observer["ownedStarts"]]
    def time(raw):
        return Decimal(raw["time"].split("T", 1)[1].split("+", 1)[0].replace(":", ""))
    ended = []
    for raw in confirmed:
        ends = [event for event in start_end if event["opcode"] == "1" and event["pid"] == raw["pid"]
                and event["processKey"] == raw["processKey"] and time(raw) <= time(event) <= time(late)]
        if len(ends) == 1:
            ended.append(raw["ordinal"])
    interval = [event for event in start_end if event["opcode"] == "1" and time(early) <= time(event) <= time(late)]
    forbidden = [r for r in interval if re.fullmatch(r"chrome(?:_proxy)?(?:[.]ex(?:e)?)?", r["image"] or "", flags=re.I)
                 or ((r["image"] or "").lower() in ("node", "node.exe") and
                     re.search(r"[\\/]main[.]js(?:[ \x22]|$)", r["commandLine"] or "", flags=re.I))]
    return base | {"witness": observer["classification"], "problems": observer["problems"],
                   "canaries": [early, late], "directMatches": len(observer["caseBirths"]),
                   "rootedStarts": len(confirmed), "rootedEnded": len(ended), "forbiddenRawStarts": forbidden}


def main():
    identity = audit_identity()
    supervisor = read(SUPERVISOR / "launch-result.json")
    outer = direct_children(SUPERVISOR)
    driver = direct_children(EVIDENCE)
    driver_summary = EVIDENCE / "summary.json"
    summary = read(driver_summary) if driver_summary.exists() else {"cases": []}
    cases = verify_matrix(summary)
    print(json.dumps({"identity": identity, "supervisor": supervisor, "driverSummary": summary | {"cases": len(summary["cases"])},
                      "outerChildren": outer, "driverChildCount": len(driver),
                      "incompleteDriverChildren": [c for c in driver if c["timeout"] or len(c["receipts"]) != 3],
                      "cases": cases, "trace": inspect_trace()}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
