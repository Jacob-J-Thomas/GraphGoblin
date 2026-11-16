from hashlib import sha256
from pathlib import Path, PurePosixPath
import json
import re

ROOT = Path(__file__).resolve().parent
ORIGINAL_NATIVE = ROOT.parent / "launcher-436-native-v2-preparation"
ORIGINAL_EXECUTION = ROOT.parent / "launcher-436-execution-v3-preparation"
NATIVE = ROOT / "native"
EXECUTION = ROOT / "execution"
SOURCE_NEUTRAL = {"README.md", "syntax-readback.json"}
VALIDATOR = "ROOT_VERIFIED_CANDIDATE_VALIDATOR_ARGUMENT"


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def verify_packet(folder):
    manifest = folder / "SHA256SUMS.txt"
    rows = {}
    for line in manifest.read_text().splitlines():
        expected, name = line.split("  ", 1)
        path = PurePosixPath(name)
        assert re.fullmatch("[0-9a-f]{64}", expected)
        assert str(path) == name and not path.is_absolute() and ".." not in path.parts and name not in rows
        assert digest(folder / name) == expected
        rows[name] = expected
    members = {p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file()}
    assert members == rows.keys() | {manifest.name}
    return digest(manifest), rows


def changed(before, after):
    assert before.keys() == after.keys()
    return {name for name in before if before[name] != after[name]}


def compare_file(before, after, replacements):
    data = before.read_bytes()
    for left, right, count in replacements:
        left = left.encode()
        assert data.count(left) == count, (before.name, left)
        data = data.replace(left, right.encode())
    assert data == after.read_bytes(), before.name


def main():
    old_pin, old_driver = verify_packet(ORIGINAL_NATIVE)
    prior_exec_pin, old_exec = verify_packet(ORIGINAL_EXECUTION)
    native_hash, native = verify_packet(NATIVE)
    exec_hash, execution = verify_packet(EXECUTION)
    assert old_pin == "ea5250650dc7f7b7815dd88c20476c50931ef29ae93467da1169c930aab47c1a"
    assert prior_exec_pin == "b134339e89f697440e3884b771143db2538d26453791a5cfdea4f36488132495"
    assert len(native) == 6 and len(execution) == 10
    assert changed(old_driver, native) == SOURCE_NEUTRAL | {"run.ps1"}
    assert changed(old_exec, execution) == SOURCE_NEUTRAL | {
        "bind.mjs", "supervise.ps1", "admission.example.json", "carrier-steps.example.yml",
    }

    compare_file(ORIGINAL_NATIVE / "run.ps1", NATIVE / "run.ps1",
                 [("$qaDeadlineSeconds = 310", "$qaDeadlineSeconds = 450", 1)])
    compare_file(ORIGINAL_EXECUTION / "supervise.ps1", EXECUTION / "supervise.ps1",
                 [("$qaResults 335000", "$qaResults 475000", 1)])
    compare_file(ORIGINAL_EXECUTION / "bind.mjs", EXECUTION / "bind.mjs", [(old_pin, native_hash, 1)])
    compare_file(ORIGINAL_EXECUTION / "admission.example.json", EXECUTION / "admission.example.json",
                 [(old_pin, native_hash, 1), ('"phase": "baseline"', '"phase": "candidate"', 1),
                  ("qa436-baseline-first", "qa436-candidate-first", 1),
                  ('"validatorArgument": null', f'"validatorArgument": "{VALIDATOR}"', 1)])
    compare_file(ORIGINAL_EXECUTION / "carrier-steps.example.yml", EXECUTION / "carrier-steps.example.yml",
                 [(old_pin, native_hash, 1), ("QA436_PHASE: baseline", "QA436_PHASE: candidate", 1),
                  ("qa436-baseline-first", "qa436-candidate-first", 4),
                  ("QA436_VALIDATOR_ARGUMENT: ''", f"QA436_VALIDATOR_ARGUMENT: {VALIDATOR}", 1)])

    binder = (EXECUTION / "bind.mjs").read_text()
    bind_pin, = re.findall(r"^const driverSeal = '([a-f0-9]{64})';$", binder, re.MULTILINE)
    carrier = (EXECUTION / "carrier-steps.example.yml").read_text()
    carrier_pin, = re.findall(r"^    \$requiredDriverSha = '([a-f0-9]{64})'$", carrier, re.MULTILINE)
    admission = json.loads((EXECUTION / "admission.example.json").read_bytes())
    assert bind_pin == carrier_pin == admission["driverManifestSha256"] == native_hash
    assert admission["phase"] == "candidate" and admission["evidenceName"] == "qa436-candidate-first"
    assert admission["validatorArgument"] == VALIDATOR
    for variable, members in (("driverMembers", native), ("packetMembers", execution)):
        body, = re.findall(r"^const " + variable + r" = \[([^\]]+)\];$", binder, re.MULTILINE)
        assert set(re.findall(r"'([^']+)'", body)) == set(members)

    timing = ROOT.parent / "launcher/436-hosted-baseline-retry/timing-readback.json"
    timing_hash = digest(timing)
    assert timing_hash == "40d6e3b46be78a609d92ae8fd3377d061a14be62e550ef20ce6658b5bde47910"
    observed = json.loads(timing.read_bytes())
    print(json.dumps({"scope": "static proposal and coherence only", "previousNativeSeal": old_pin,
                      "previousExecutionSeal": prior_exec_pin, "nativeSeal": native_hash, "executionSeal": exec_hash,
                      "pinnedNativeSha256": {"actualManifest": native_hash, "binder": bind_pin,
                                            "admissionExample": admission["driverManifestSha256"], "carrierExample": carrier_pin},
                      "nativeMembers": len(native), "executionMembers": len(execution),
                      "nativeUnchanged": sorted(set(native) - changed(old_driver, native)),
                      "executionUnchanged": sorted(set(execution) - changed(old_exec, execution)),
                      "driverScheduleSeconds": 450, "directDriverWaitSeconds": 475, "matrixCount": 32,
                      "baselineTimingEvidenceSha256": timing_hash,
                      "measuredBaselineSeconds": observed["driverSchedulingElapsed"],
                      "proposedHeadroomSeconds": 450 - observed["driverSchedulingElapsed"]}, indent=2))


if __name__ == "__main__":
    main()
