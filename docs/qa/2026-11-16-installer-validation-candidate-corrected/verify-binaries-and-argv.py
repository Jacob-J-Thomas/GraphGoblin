from collections import Counter
from datetime import datetime
from hashlib import sha256
from pathlib import Path, PureWindowsPath
import ctypes
from ctypes import wintypes
import json
import re
from struct import unpack_from

P = Path(__file__).parent
E = P / "artifact/qa436-candidate-corrected/evidence"
S = P / "artifact/qa436-candidate-corrected-supervisor"


def read(path):
    return json.loads(path.read_bytes())


def sha(path):
    return sha256(path.read_bytes()).hexdigest()


def argv(command):
    shell32 = ctypes.WinDLL("shell32")
    split = shell32.CommandLineToArgvW
    split.argtypes = (wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int))
    split.restype = ctypes.POINTER(wintypes.LPWSTR)
    kernel32 = ctypes.WinDLL("kernel32")
    kernel32.LocalFree.argtypes = (wintypes.HLOCAL,)
    kernel32.LocalFree.restype = wintypes.HLOCAL
    count = ctypes.c_int()
    value = split(command, ctypes.byref(count))
    if not value:
        raise RuntimeError("Captured argv could not be parsed.")
    try:
        return [value[index] for index in range(count.value)]
    finally:
        kernel32.LocalFree(value)


def dt(value):
    return datetime.fromisoformat(value)


def owned_argv():
    observer = read(S / "observer-summary.json")
    assert not observer["problems"]
    for which, event in zip(("before", "after"), observer["canaries"]):
        receipt = read(S / f"canary-{which}.spawn.json")
        marker = (S / f"canary-{which}.stdout").read_text()
        assert event["pid"] == receipt["pid"] and event["parent"] == receipt["parentPid"]
        assert abs((dt(receipt["birthUtc"]) - dt(event["time"])).total_seconds()) < 0.1
        assert argv(event["commandLine"]) == [receipt["executable"], *receipt["arguments"]]
        assert marker in receipt["arguments"][1]
    driver = observer["driver"]
    receipt = read(S / "driver.spawn.json")
    assert driver["pid"] == receipt["pid"] and driver["parent"] == receipt["parentPid"]
    assert abs((dt(receipt["birthUtc"]) - dt(driver["time"])).total_seconds()) < 0.1
    assert argv(driver["commandLine"]) == [receipt["executable"], *receipt["arguments"]]
    rows = []
    for match in observer["caseBirths"]:
        hosted = PureWindowsPath(match["file"])
        index = hosted.parts.index("evidence")
        receipt = E.joinpath(*hosted.parts[index + 1:])
        original = read(receipt)
        prefix = receipt.name.removesuffix(".spawn.json")
        attempted = read(receipt.with_name(prefix + ".attempt.json"))
        exited = read(receipt.with_name(prefix + ".exit.json"))
        matched = match["start"]
        assert matched["pid"] == original["pid"] and matched["parent"] == driver["pid"]
        assert abs((dt(original["startedUtc"]) - dt(matched["time"])).total_seconds()) < 0.1
        assert argv(matched["commandLine"]) == [original["executable"], *attempted["arguments"]]
        limit = attempted["timeoutMs"]
        seconds = (dt(exited["exitedUtc"]) - dt(original["startedUtc"])).total_seconds()
        assert 0 < seconds < limit / 1000
        rows.append({"path": receipt.relative_to(E).as_posix(), "kind": prefix, "pid": original["pid"],
                     "seconds": seconds, "scheduledLimitMs": limit, "exitCode": exited["exitCode"]})
    assert len(rows) == 49
    return rows


def outputs():
    nodes = read(E / "binding.json")["files"]
    real_node = next(path for path in nodes if PureWindowsPath(path).name == "node.exe")
    checked_positive = []
    checked_seeds = 0
    for number in range(1, 33):
        case = E / f"{number:02}"
        if (case / "seed-files").exists():
            seed = read(case / "seed-after.json")
            for field, entry in seed.items():
                if entry["kind"] != "file":
                    continue
                f = case / "seed-files" / (field + PureWindowsPath(entry["path"]).suffix)
                assert entry["sha256"] == sha(f) and f.stat().st_size == entry["bytes"]
                checked_seeds += 1
        if number > 4:
            continue
        after = read(case / "after.json")
        before = read(case / "before.json")
        request = read(case / "installer.request.json")["options"]
        assert before["source"] == after["source"] and before["foreign"] == after["foreign"]
        before_config = read(case / "seed-files/config.json") if (case / "seed-files/config.json").exists() else None
        config = read(case / "after-files/config.json")
        assert config["Repo"] == request["RepoPath"] and config["Node"] == real_node
        assert config["DataDir"] == request["DataDir"] and config["Port"] == request["Port"]
        source = before["source"]["link"]
        assert config["ChromeProfile"] == "QA 436 fixture" and config["ChromeProxy"] == source["target"]
        assert config["PwaAppUserModelId"] == source["appId"] and config["IconLocation"] == source["icon"]
        assert "--app-id=" + config["ChromeAppId"] in source["arguments"]
        assert (number == 4) == ("NodePath" not in request)
        assert (number == 3) == request.get("NoShortcuts", False)
        exe = (case / "after-files/exe.exe").read_bytes()
        pe_at, = unpack_from("<I", exe, 0x3C)
        assert exe[:2] == b"MZ" and exe[pe_at:pe_at + 4] == b"PE\0\0" and unpack_from("<H", exe, pe_at + 4)[0] == 0x8664
        if before_config:
            assert before_config["LauncherAppUserModelId"] == config["LauncherAppUserModelId"]
            assert before_config["Environment"]["GG_LOG_LEVEL"] == "info" and config["Environment"]["GG_LOG_LEVEL"] == "warn"
        outputs = ("desktop", "programs", "pin") if number in (2, 3) else ("desktop", "programs")
        for name in outputs:
            if number == 3:
                assert after[name] == before[name]
            link = after[name]["link"]
            assert link["target"] == after["exe"]["path"]
            assert link["workingDirectory"] == request["InstallDir"]
            assert argv('"probe.exe" ' + link["arguments"])[1:] == ["--config", after["config"]["path"]]
            assert link["appId"] == config["LauncherAppUserModelId"] and link["icon"] == config["IconLocation"]
        assert PureWindowsPath(after["desktop"]["path"]).name == "Desktop α.lnk"
        assert PureWindowsPath(after["programs"]["path"]).name == "Programs 雪.lnk"
        checked_positive.append({"case": f"{number:02}", "compiledWin64": True, "inputUnchanged": True,
                                 "expectedLinks": list(outputs), "appUserModelId": config["LauncherAppUserModelId"]})
    return checked_positive, checked_seeds


def validator_and_refusals():
    observation = read(S / "observer-summary.json")
    owned = {node["ordinal"]: node for node in observation["ownedStarts"]}
    direct = {PureWindowsPath(match["file"]).as_posix().split("/evidence/", 1)[1]: match["start"]["ordinal"]
              for match in observation["caseBirths"]}
    validations = []
    for number in range(1, 5):
        case = f"{number:02}"
        parent = direct[f"{case}/installer.spawn.json"]
        descendants = {parent}
        matches = []
        for node in owned.values():
            if node.get("parentBirthOrdinal") not in descendants:
                continue
            descendants.add(node["ordinal"])
            args = argv(node["commandLine"])
            if "--validate-install" in args:
                matches.append((node, args))
            if case == "03":
                assert "--stage-shortcut" not in args
        assert len(matches) == 1
        node, args = matches[0]
        exe = PureWindowsPath(args[0])
        assert len(args) == 4 and args[1:3] == ["--validate-install", "--config"]
        assert exe.name.lower() == "graphgoblin.exe" and exe.parent.name.startswith("gg-launcher-stage-")
        assert PureWindowsPath(args[3]) == exe.with_name(exe.name + ".json")
        assert f"/work/{case}/" in exe.as_posix()
        validations.append({"case": case, "pid": node["pid"], "installerBirthOrdinal": parent, "stagedArguments": args})

    for number in range(5, 33):
        case = E / f"{number:02}"
        disposition = read(case / "result.json")
        assert disposition["process"]["exitCode"] != 0 and not disposition["changed"]
        before, after = [read(case / f"{stage}.json") for stage in ("before", "after")]
        assert before == after
        diagnostic = "\n".join((case / f"installer.{pipe}").read_text(encoding="utf-8-sig") for pipe in ("stdout", "stderr"))
        assert not re.search("GG436_(PRIVATE_PATH|RAW_VERSION)_CANARY", diagnostic)
        assert disposition["status"] == "refusal-met" and not disposition["problems"]
        if number == 6:
            assert re.search(r"\bNode\b.*22\.22\.2", diagnostic, flags=re.I | re.S)
            assert "-NodePath" in diagnostic and "PropertyNotFoundStrict" not in diagnostic
            assert "NodePath" not in read(case / "installer.request.json")["options"]
            assert read(case / "installer.attempt.json")["path"] == r"C:\Windows\System32;C:\Windows"
    cleanup = read(E / "summary.json")["knownFolderCleanup"]
    assert len(cleanup) == 1 and cleanup[0]["deletedExactOriginal"] and not cleanup[0]["retained"]
    return validations, cleanup[0]


def main():
    times = owned_argv()
    positive, seed_files = outputs()
    assert Counter(row["kind"] for row in times) == {"installer": 32, "seed": 15, "real-node": 1, "version-fixture-compiler": 1}
    raw = read(P / "independent-readback.json")
    cases = raw["cases"]
    assert all(c["portListeningAfter"] is False for c in cases)
    assert all("Disposable service or store has side effects." not in c.get("problems", []) for c in cases)
    validators, ordinary_desktop_cleanup = validator_and_refusals()
    print(json.dumps({"positiveOutputs": positive, "verifiedSeedFileCopies": seed_files,
                      "verifiedBeforeAfterCopies": sum(c["archivedFileChecks"] for c in cases),
                      "exactCapturedArgvMatches": len(times) + 3, "all32ListenerReadbacksAbsent": True,
                      "unchangedNonzeroInstallInputs": 28, "refusalCriteriaMet": 28, "correctedDiagnosticCase": "06",
                      "nativeValidators": validators,
                      "disposableDesktopCleanup": ordinary_desktop_cleanup,
                      "directInvocationTimings": times}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
