from hashlib import sha256
import json
from pathlib import Path, PureWindowsPath
from struct import unpack_from
from uuid import UUID

ROOT = Path(__file__).parent
ARTIFACT = ROOT / "artifact"
CASES = ARTIFACT / "probe"
PROPOSAL = ROOT.parents[1] / "launcher-436-com-probe-preparation"


def read_json(path):
    return json.loads(path.read_bytes())


def digest(payload):
    return sha256(payload).hexdigest()


def link_fields(path):
    data = path.read_bytes()
    size, = unpack_from("<I", data)
    clsid = UUID(bytes_le=data[4:20])
    flags, = unpack_from("<I", data, 20)
    assert size == 0x4C and str(clsid) == "00021401-0000-0000-c000-000000000046"
    assert flags & 0x80
    offset = size
    if flags & 1:
        offset += 2 + unpack_from("<H", data, offset)[0]
    if flags & 2:
        offset += unpack_from("<I", data, offset)[0]
    strings = {}
    for bit, field in ((4, "name"), (8, "relativePath"), (16, "workingDirectory"), (32, "arguments"), (64, "icon")):
        if flags & bit:
            chars, = unpack_from("<H", data, offset)
            offset += 2
            length = 2 * chars
            strings[field] = data[offset:offset + length].decode("utf-16-le")
            offset += length
    while True:
        length, = unpack_from("<I", data, offset)
        if length == 0:
            assert offset + 4 == len(data)
            break
        assert 8 <= length <= len(data) - offset
        signature, = unpack_from("<I", data, offset + 4)
        if signature == 0xA0000009:
            property_data = data[offset:offset + length]
        offset += length
    return {"size": len(data), "sha256": digest(data), "strings": strings,
            "propertyStoreBytes": len(property_data), "appIdUtf16Present":
            "GraphGoblin.QA436.Source".encode("utf-16-le") in property_data}


def main():
    unicode_case = CASES / "01-unicode"
    ascii_case = CASES / "02-ascii"
    expected = read_json(CASES / "input.json")
    greek = read_json(unicode_case / "post-save.json")
    before = read_json(ascii_case / "post-save.json")
    after = read_json(ascii_case / "post-property-store.json")
    requested = read_json(unicode_case / "requested.json")
    assert PureWindowsPath(requested["path"]).name == "Chrome α.lnk"
    assert greek["requestedPath"] == requested["path"]
    assert read_json(unicode_case / "wsh-save.json")["returned"]
    assert greek["exactFileExists"] is False
    assert greek["entries"] == [{"Name": "Chrome a.lnk", "Attributes": 32, "Length": 2254}]
    post_property = read_json(unicode_case / "post-property-store.json")
    for snapshot in (greek, post_property):
        assert snapshot["fileInspectionError"].pop("stack").startswith("at Snapshot, ")
    assert greek == post_property
    assert not (CASES / "work/01/source/Chrome α.lnk").exists()
    for name in ("write-open", "read-open"):
        receipt = read_json(unicode_case / f"{name}.json")
        assert receipt["hresult"] == "0x80070002" and not receipt["succeeded"]
    assert not any((unicode_case / file).exists() for file in ("write-set.json", "write-commit.json", "read-get.json"))
    assert read_json(ascii_case / "wsh-save.json")["returned"]
    assert before["exactFileExists"] and after["exactFileExists"]
    assert before["file"]["Path"] == after["file"]["Path"] == before["requestedPath"]
    assert before["file"]["Volume"] == after["file"]["Volume"]
    assert before["file"]["FileId"] != after["file"]["FileId"]
    for name in ("write-open", "write-set", "write-clear", "write-commit", "read-open", "read-get", "read-clear"):
        receipt = read_json(ascii_case / f"{name}.json")
        assert receipt["hresult"] == "0x00000000" and receipt["succeeded"]
    result = read_json(ascii_case / "disposition.json")
    assert result["roundTrip"] and result["reopenedValue"] == {"VariantType": 31, "Value": expected["appUserModelId"]}
    assert before["link"] == after["link"] == {
        "target": expected["target"]["Path"], "arguments": expected["arguments"],
        "workingDirectory": str(PureWindowsPath(expected["target"]["Path"]).parent),
        "icon": expected["target"]["Path"] + ",0",
    }
    latin = CASES / "work/01/source/Chrome a.lnk"
    saved = ascii_case / "post-save.lnk.bin"
    committed = CASES / "work/02/source/Chrome A.lnk"
    assert latin.read_bytes() == saved.read_bytes()
    saved_fields = link_fields(saved)
    committed_fields = link_fields(committed)
    assert saved_fields["sha256"] == before["sha256"] and committed_fields["sha256"] == after["sha256"]
    assert saved_fields["strings"] == committed_fields["strings"] == {
        key: before["link"][key].removesuffix(",0") if key == "icon" else before["link"][key]
        for key in ("workingDirectory", "arguments", "icon")
    }
    assert not saved_fields["appIdUtf16Present"] and committed_fields["appIdUtf16Present"]
    launch = read_json(ARTIFACT / "attempt.json")
    merge = read_json(ROOT / "checkout-merge.json")
    window = read_json(ROOT / "windows-job.json")
    run = read_json(ROOT / "actions-run.json")
    assert run["id"] == window["run_id"] == 43801684182 and run["run_attempt"] == window["run_attempt"] == 1
    assert window["id"] == 133083194588 and window["conclusion"] == "success"
    assert launch["head"] == merge["sha"] == expected["checkoutHead"]
    assert launch["tree"] == merge["tree"]["sha"]
    assert launch["parents"] == [p["sha"] for p in merge["parents"]]
    assert launch["parents"][1] == run["head_sha"]
    for filename, source in (("probe.ps1", PROPOSAL / "probe.ps1"), ("PropertyStoreProbe.cs", PROPOSAL / "PropertyStoreProbe.cs"),
                             ("windows.cs", PROPOSAL.parent / "launcher-436-native-preparation" / "windows.cs")):
        matches = [value for key, value in launch["inputs"].items() if PureWindowsPath(key).name == filename]
        assert matches == [digest(source.read_bytes())]
    spawn, exit_, close = [read_json(ARTIFACT / f"{name}.json") for name in ("spawn", "exit", "close")]
    assert spawn["pid"] == exit_["pid"] == close["pid"] == 6272
    assert spawn["birthUtc"] == exit_["birthUtc"] < exit_["exitUtc"] < close["closedUtc"]
    assert exit_["exitCode"] == 0 and close["streamsClosed"]
    assert close["stdoutBytes"] == close["stderrBytes"] == 0
    assert (ARTIFACT / "stdout.txt").read_bytes() == (ARTIFACT / "stderr.txt").read_bytes() == b""
    summary, wrapper = [read_json(path) for path in (CASES / "summary.json", ARTIFACT / "result.json")]
    assert wrapper["closingIdentityVerified"] and summary["status"] == wrapper["status"] == "diagnostic-complete"
    assert summary["recordedCases"] == wrapper["recordedCases"] == 2
    print(json.dumps({"scope": "hosted Shell Link diagnostic only", "actualSurrogate": latin.name,
                      "sameBytesAsAsciiBeforeCommit": True, "beforeCommit": saved_fields,
                      "afterCommit": committed_fields, "spawn": spawn, "exit": exit_, "close": close},
                      indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
