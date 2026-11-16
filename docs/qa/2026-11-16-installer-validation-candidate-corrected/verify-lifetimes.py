from collections import defaultdict
from datetime import datetime
from pathlib import Path, PureWindowsPath
from xml.etree import ElementTree as ET
import json

ROOT = Path(__file__).parent
SUPERVISOR = ROOT / "artifact/qa436-candidate-corrected-supervisor"
EVIDENCE = ROOT / "artifact/qa436-candidate-corrected/evidence"
PROVIDER = "9e814aad-3204-11d2-9a82-006008a86939"
CLASSIC_PROCESS = "3d6fa8d0-fe05-11d0-9dda-00c04fd7ba7c"


def read(path):
    return json.loads(path.read_bytes())


def order(event):
    return event["time"], event["ordinal"]


def main():
    hosted = read(SUPERVISOR / "observer-summary.json")
    by_ordinal = {}
    by_pid = defaultdict(list)
    xml = ET.parse(SUPERVISOR / "process-start.xml").getroot()
    for ordinal, event in enumerate(xml.findall(".//{*}Event"), 1):
        system = event.find("{*}System")
        if system is None:
            continue
        version = system.findtext("{*}Version")
        opcode = system.findtext("{*}Opcode")
        provider_element = system.find("{*}Provider")
        provider = provider_element.get("Guid", "").strip("{}").lower() if provider_element is not None else ""
        event_guid = event.findtext("{*}ExtendedTracingInfo/{*}EventGuid", "").strip("{}").lower()
        if (provider, event_guid) != (PROVIDER, CLASSIC_PROCESS) or opcode not in ("1", "2"):
            continue
        assert version == "4"
        data = {item.get("Name"): item.text for item in event.findall("./{*}EventData/{*}Data")}
        event_time = system.find("{*}TimeCreated").get("SystemTime")
        assert event_time.endswith("+00:00") and len(event_time) == 35
        row = {"ordinal": ordinal, "opcode": opcode, "time": event_time, "pid": int(data["ProcessId"], 0),
               "key": data["UniqueProcessKey"], "parent": int(data["ParentId"], 0),
               "image": data["ImageFileName"], "argv": data["CommandLine"], "exitStatus": int(data["ExitStatus"])}
        by_ordinal[ordinal] = row
        by_pid[row["pid"]].append(row)
    for rows in by_pid.values():
        rows.sort(key=order)
    early, late = [by_ordinal[c["ordinal"]] for c in hosted["canaries"]]
    direct = {}
    for match in hosted["caseBirths"]:
        relative = PureWindowsPath(match["file"]).as_posix().split("/evidence/", 1)[1]
        stem = relative.removesuffix(".spawn.json")
        direct[match["start"]["ordinal"]] = stem
    owned = {row["ordinal"]: row for row in hosted["ownedStarts"]}
    close_gate = datetime.fromisoformat(hosted["driverClose"]["closedUtc"])
    pair_count = 0
    matched_direct = []
    saved_pairs = []
    for ordinal, observed in owned.items():
        start = by_ordinal[ordinal]
        assert start["opcode"] == "1" and order(early) < order(start) < order(late)
        assert start["pid"] == observed["pid"] and start["parent"] == observed["parent"]
        assert start["argv"] == observed["commandLine"]
        assert start["key"] and start["image"] == observed["image"]
        later = [row for row in by_pid[start["pid"]] if order(start) < order(row)]
        next_birth = next((row for row in later if row["opcode"] == "1"), None)
        eligible = [row for row in later if row["opcode"] == "2" and order(row) < order(late)
                    and (next_birth is None or order(row) < order(next_birth))]
        assert len(eligible) == 1, (start, next_birth, eligible)
        end, = eligible
        assert all(start[k] == end[k] for k in ("pid", "key", "parent", "image")), (start, end)
        pair_count += 1
        if ordinal in direct or ordinal == hosted["driver"]["ordinal"]:
            prefix = direct.get(ordinal, "driver")
            path_root = EVIDENCE if ordinal in direct else SUPERVISOR
            spawn, exited, closed = [read(path_root / f"{prefix}.{part}.json") for part in ("spawn", "exit", "close")]
            birth_field = "startedUtc" if ordinal in direct else "birthUtc"
            exit_field = "exitedUtc" if ordinal in direct else "exitUtc"
            assert spawn["pid"] == exited["pid"] == closed["pid"] == start["pid"]
            assert spawn[birth_field] == exited[birth_field] and closed["streamsClosed"]
            assert end["exitStatus"] == exited["exitCode"] == closed["exitCode"]
            time = datetime.fromisoformat
            assert time(spawn[birth_field]) < time(end["time"]) <= close_gate
            matched_direct.append({"receipt": prefix, "pid": start["pid"], "startOrdinal": ordinal,
                "endOrdinal": end["ordinal"], "nativeEndUtc": end["time"], "directExitUtc": exited[exit_field],
                "actualDirectExitCode": exited["exitCode"], "streamsClosed": closed["streamsClosed"]})
        if start["pid"] in (8984, 2352):
            parent = observed
            while parent and parent["ordinal"] not in direct:
                parent = owned.get(parent.get("parentBirthOrdinal"))
            assert parent
            saved_pairs.append({"start": start, "end": end, "nextSamePidBirth": next_birth,
                "nearestDirectInstallerReceipt": direct[parent["ordinal"]]})

    assert pair_count == len(owned) == 399 and len(matched_direct) == 50
    assert len(saved_pairs) == 5
    broad = read(ROOT / "key-end-first-discrepancy.json")["unresolvedByFirstStaticRule"]
    assert sorted(row["matchCount"] for row in broad) == [2, 2, 3]
    assert {row["start"]["ordinal"] for row in broad} == {385, 593, 594}
    assert {row["start"]["ordinal"] for row in saved_pairs} == {385, 593, 594, 875, 1068}
    print(json.dumps({"scope": "retained native process events; cutoff at closing canary birth",
        "openingCanaryOrdinal": early["ordinal"], "closingCanaryOrdinal": late["ordinal"],
        "pairedRootedLifetimes": pair_count, "unpairedOrAmbiguousLifetimes": 0,
        "pairCriteria": ["same PID, process key, parent and image", "one end after birth and before next same-PID birth",
                         "end prior to closing canary birth"],
        "discrepancyDisposition": "Combined process key and PID were reused after completed lifetimes",
        "reusedPidEventPairs": saved_pairs, "actualDirectExitMatches": matched_direct}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
