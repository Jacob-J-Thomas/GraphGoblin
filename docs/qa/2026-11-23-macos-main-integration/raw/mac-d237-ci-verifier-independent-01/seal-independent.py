"""Seal this new refusal packet; reverify exact reviewed inputs without operational actions."""
from hashlib import sha256
import json
from pathlib import Path

O = Path(__file__).resolve().parent


def descriptor(path):
    data = path.read_bytes()
    return {"source": str(path), "bytes": len(data), "sha256": sha256(data).hexdigest()}


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, indent=2)
        output.write("\n")


findings = json.loads((O / "offline-findings.json").read_bytes())
for key in ("script", "preparationManifest", "workflow"):
    if descriptor(Path(findings[key]["source"])) != findings[key]:
        raise AssertionError("Reviewed input changed: " + key)
packet = Path(findings["preparationManifest"]["source"]).parent
for name, wanted in json.loads((packet / "MANIFEST.sha256.json").read_bytes())["files"].items():
    got = descriptor(packet / name)
    if got["bytes"] != wanted["bytes"] or got["sha256"] != wanted["sha256"]:
        raise AssertionError("Preparation member changed: " + name)
rows = []
for path in sorted(O.rglob("*")):
    if path.is_file() and path.name not in ("MANIFEST.sha256.json", "SEAL.json"):
        got = descriptor(path)
        rows.append({"path": path.relative_to(O).as_posix(), "bytes": got["bytes"], "sha256": got["sha256"]})
save(O / "MANIFEST.sha256.json", {"files": rows})
save(O / "SEAL.json", {"kind": "SEALED_D237_CI_VERIFIER_MECHANICS_REFUSAL",
     "scope": "D237-current-seven-job-CI-verifier-mechanics", "mechanicsAccepted": False,
     "actualRuntimeAdmission": False, "members": len(rows), "manifest": descriptor(O / "MANIFEST.sha256.json"),
     "refusal": descriptor(O / "REFUSAL.json"), "script": findings["script"],
     "preparationManifest": findings["preparationManifest"], "workflow": findings["workflow"],
     "actualCiGitHubGitNodeProviderOrProductActions": 0, "currentRunAcceptance": False})
for item in rows:
    got = descriptor(O / item["path"])
    if got["bytes"] != item["bytes"] or got["sha256"] != item["sha256"]:
        raise AssertionError("Own member changed: " + item["path"])
print(json.dumps({"members": len(rows), "manifest": descriptor(O / "MANIFEST.sha256.json"),
                  "seal": descriptor(O / "SEAL.json"), "refusal": descriptor(O / "REFUSAL.json")}))
