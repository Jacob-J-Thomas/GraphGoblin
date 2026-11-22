from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

evidence = Path("G:/ggq/delivery-evidence/2026-11-17-five-intents")
original = evidence / "i4-486-d215-author-01"
out = evidence / "i4-486-d215-author-erratum-01"
transcript = Path(
    "C:/Users/98jak/.codex/sessions/2026/11/21/"
    "rollout-2026-11-21T16-04-57-01a20024-2053-74f3-b271-c7fea6b7c39c.jsonl"
)
author_seal = "99bc9f0718129b926615170630e9600fdbca19a40b290072dfae9d3f3134f226"
assert sha256((original / "SHA256-MANIFEST.json").read_bytes()).hexdigest() == author_seal
original_members = json.loads((original / "SHA256-MANIFEST.json").read_bytes())
assert original_members["count"] == 56
for member in original_members["files"]:
    data = (original / member["path"]).read_bytes()
    assert len(data) == member["bytes"] and sha256(data).hexdigest() == member["sha256"]

ordinary = "G:/ggq/gg-i4-486-d215-fix/process-temp"
physical = "G:/ggq/gg-i4-486-d215-fix/junction-physical"
cross = "C:/Users/98jak/graphgoblin-qa/d215-small-native-temp-6f0b6fbedf2347e9a7c7b0e82a4a2ece"
zero = " tempFixtures=0 packageRelativeFixtures=0 checkoutRelativeFixtures=0"
records = [
    ("22-original-junction-cleanup.log", "22-original-junction-cleanup.stdout", 117, "0bc98e", physical, 0),
    ("25-corrected-ordinary-cleanup.log", "25-broad-ordinary-cleanup.stdout", 124, "3800cc", ordinary, 1),
    ("27-corrected-junction-cleanup.log", "27-corrected-junction-cleanup.stdout", 147, "5cc00c", physical, 0),
    ("35-corrected-ordinary-cleanup.log", "35-touched-ordinary-cleanup.stdout", 138, "94d6f4", ordinary, None),
    ("30-corrected-cross-volume-cleanup.log", "30-cross-volume-fixture-counts.stdout", 147, "5cc00c", cross, 0),
]
lines = transcript.read_bytes().splitlines()
provenance = []
for report_link, name, line_number, chunk, root, exit_code in records:
    row = json.loads(lines[line_number - 1])
    assert row["type"] == "response_item"
    assert row["payload"]["type"] == "custom_tool_call_output"
    matching_chunks = []
    for content in row["payload"]["output"]:
        value = content["text"]
        if not value.startswith('{"chunk_id":'):
            continue
        decoded = json.loads(value)
        if decoded["chunk_id"] == chunk:
            matching_chunks.append(decoded)
    tool, = matching_chunks
    assert tool.get("exit_code") == exit_code
    matching, = [
        observed for observed in tool["output"].splitlines(keepends=True)
        if observed.rstrip("\r\n") == f"tempRoot={root}{zero}"
    ]
    data = matching.encode("utf-8")
    with (out / name).open("xb") as file:
        file.write(data)
    provenance.append({
        "originalReportLink": report_link,
        "originalReportLinkExists": (original / report_link).exists(),
        "recoveredOutput": name,
        "transcriptLine": line_number,
        "transcriptTimestamp": row["timestamp"],
        "toolCallId": row["payload"]["call_id"],
        "commandOutputChunkId": chunk,
        "commandExitCode": exit_code,
        "bytes": len(data),
        "sha256": sha256(data).hexdigest(),
    })
cross_removal = (original / "30-corrected-cross-volume-cleanup.log").read_text(encoding="utf-8-sig")
assert "removed=True" in cross_removal

task = Path("G:/ggq/gg-i4-486-d215-fix")
checkout = task / "GraphGoblin"
snapshot = {
    "utc": datetime.now(timezone.utc).isoformat(),
    "scope": "Current read-only observation after the author suite and commit",
    "ordinaryTempFixtures": sorted(p.name for p in (task / "process-temp").glob("gg-wp-e3-*")),
    "junctionPhysicalTempFixtures": sorted(p.name for p in (task / "junction-physical").glob("gg-wp-e3-*")),
    "checkoutRelativeFixtures": sorted(p.name for p in checkout.glob("gg-wp-relative-*")),
    "packageRelativeFixtures": sorted(p.name for p in (checkout / "packages/infrastructure").glob("gg-wp-relative-*")),
    "crossVolumeRootExists": Path(cross).exists(),
}
for name, value in [
    ("TRANSCRIPT-PROVENANCE.json", {
        "transcriptPath": str(transcript),
        "extraction": "Exact UTF-8 bytes of the decoded command-output line, preserving its line ending",
        "authorSealSha256": author_seal,
        "originalAuthorSealVerifiedMembers": len(original_members["files"]),
        "observations": provenance,
    }),
    ("CURRENT-CLEANUP-SNAPSHOT.json", snapshot),
]:
    with (out / name).open("x", encoding="utf-8", newline="\n") as file:
        file.write(json.dumps(value, indent=2) + "\n")
print(json.dumps(snapshot))
