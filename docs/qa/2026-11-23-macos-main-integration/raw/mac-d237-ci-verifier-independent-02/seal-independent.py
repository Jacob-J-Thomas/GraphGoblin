"""Seal this mechanics-only correction review; all operational inputs remain unbound."""
from hashlib import sha256
import json
from pathlib import Path

O = Path(__file__).resolve().parent
E = O.parent


def descriptor(path):
    data = path.read_bytes()
    return {"source": str(path), "bytes": len(data), "sha256": sha256(data).hexdigest()}


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, indent=2)
        output.write("\n")


controls = json.loads((O / "correction-controls.json").read_bytes())
for key in ("script", "preparationManifest"):
    if descriptor(Path(controls[key]["source"])) != controls[key]:
        raise AssertionError("Reviewed input changed: " + key)
for packet, pin in [(E / "mac-d237-ci-verifier-preparation-01", "54ef6b1266aa286436fca0fcf33994cb29878b1833a81ec83669603e5bc44bfd"),
                    (E / "mac-d237-ci-verifier-preparation-02", "2c521fc9c5fc191b12a7b146599d7bb3061fe55c6dd71912101be793848f126a")]:
    if descriptor(packet / "MANIFEST.sha256.json")["sha256"] != pin:
        raise AssertionError("Preparation manifest changed")
    for name, expected in json.loads((packet / "MANIFEST.sha256.json").read_bytes())["files"].items():
        actual = descriptor(packet / name)
        if actual["bytes"] != expected["bytes"] or actual["sha256"] != expected["sha256"]:
            raise AssertionError("Preparation member changed: " + name)
prior = E / "mac-d237-ci-verifier-independent-01"
if descriptor(prior / "MANIFEST.sha256.json")["sha256"] != "45c6756f05375d73aeb12c3e838666425738f2ecd08580301071101369e01560":
    raise AssertionError("Prior refusal manifest changed")
if descriptor(prior / "SEAL.json")["sha256"] != "a20e42467b15269c6335e4f5e2185d4971117ad9b4bf736dca79c00a1781b333":
    raise AssertionError("Prior refusal seal changed")
for item in json.loads((prior / "MANIFEST.sha256.json").read_bytes())["files"]:
    actual = descriptor(prior / item["path"])
    if actual["bytes"] != item["bytes"] or actual["sha256"] != item["sha256"]:
        raise AssertionError("Prior refusal member changed")
rows = []
for path in sorted(O.rglob("*")):
    if path.is_file() and path.name not in ("MANIFEST.sha256.json", "SEAL.json"):
        actual = descriptor(path)
        rows.append({"path": path.relative_to(O).as_posix(), "bytes": actual["bytes"], "sha256": actual["sha256"]})
save(O / "MANIFEST.sha256.json", {"files": rows})
save(O / "SEAL.json", {"kind": "SEALED_D237_CI_VERIFIER_CORRECTION_MECHANICS_ACCEPTANCE",
     "scope": "D237-current-seven-job-CI-verifier-mechanics", "mechanicsAccepted": True, "actualRuntimeAdmission": False,
     "members": len(rows), "manifest": descriptor(O / "MANIFEST.sha256.json"), "acceptance": descriptor(O / "ACCEPTANCE.json"),
     "script": controls["script"], "preparationManifest": controls["preparationManifest"],
     "priorRefusalSeal": descriptor(prior / "SEAL.json"), "rootFreshPublishedRunBindingRequired": True,
     "actualCiGitHubGitNodeProviderOrProductActions": 0, "currentRunAcceptance": False})
for item in rows:
    actual = descriptor(O / item["path"])
    if actual["bytes"] != item["bytes"] or actual["sha256"] != item["sha256"]:
        raise AssertionError("Own member changed")
print(json.dumps({"members": len(rows), "manifest": descriptor(O / "MANIFEST.sha256.json"),
                  "seal": descriptor(O / "SEAL.json"), "acceptance": descriptor(O / "ACCEPTANCE.json")}))
