# Offline, in-memory read of the CI coverage ZIP (no extraction).
# Usage: python -I read-coverage-zip.py <zip>
import hashlib
import json
import sys
import zipfile

path = sys.argv[1]
with open(path, "rb") as handle:
    data = handle.read()
print("zip sha256", hashlib.sha256(data).hexdigest(), "bytes", len(data))
with zipfile.ZipFile(path) as archive:
    names = archive.namelist()
    print("members", len(names))
    for name in sorted(names):
        raw = archive.read(name)
        digest = hashlib.sha256(raw).hexdigest()
        summary = json.loads(raw)
        total = summary["total"]
        lines = total["lines"]["pct"]
        branches = total["branches"]["pct"]
        floor = "ok" if lines >= 90 and branches >= 90 else "BELOW-FLOOR"
        print(f"{name} bytes={len(raw)} sha={digest} lines={lines} branches={branches} {floor}")
        if name.startswith("apps/api/"):
            for key, value in summary.items():
                if key.replace("\\", "/").endswith(("src/run-history.ts", "src/routes/runs.ts")):
                    print("   ", key.split("GraphGoblin")[-1], {k: (v["covered"], v["total"], v["pct"]) for k, v in value.items()})
