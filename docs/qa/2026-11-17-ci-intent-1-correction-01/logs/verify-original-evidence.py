"""Read-only check that the original author, independent QA and hosted packets are unchanged.

Each packet's SHA256SUMS.txt (LF or CRLF lines, `<hash> *<path>` or `<hash>  <path>`) is
verified against the files it lists. Nothing is written into the checked directories.
Usage: python -I verify-original-evidence.py <five-intents-root> <output.json>
"""
import hashlib
import json
import os
import sys

root, output = sys.argv[1:]
report = {}
for packet in ("i1-ci-implementation-evidence", "i1-ci-independent-qa",
               "496-hosted-uploader-control", "496-hosted-baseline-probe"):
    base = os.path.join(root, packet)
    manifest = open(os.path.join(base, "SHA256SUMS.txt"), "rb").read()
    rows = [line.rstrip(b"\r") for line in manifest.split(b"\n") if line.strip()]
    mismatches = []
    for row in rows:
        digest, name = row.decode("utf-8").split(maxsplit=1)
        name = name.lstrip("*")
        with open(os.path.join(base, name), "rb") as handle:
            if hashlib.sha256(handle.read()).hexdigest() != digest:
                mismatches.append(name)
    report[packet] = {
        "entries": len(rows),
        "mismatches": mismatches,
        "crlfManifest": b"\r\n" in manifest,
        "manifestSha256": hashlib.sha256(manifest).hexdigest(),
    }
with open(os.path.join(root, "i1-ci-claude-01", "provider-final-message.md"), "rb") as handle:
    report["originalPublicReportSha256"] = hashlib.sha256(handle.read()).hexdigest()
with open(output, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
print(json.dumps(report, indent=2))
sys.exit(0 if all(not v["mismatches"] for k, v in report.items() if isinstance(v, dict)) else 1)
