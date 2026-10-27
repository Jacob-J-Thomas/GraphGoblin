"""Read-only inspection of a stopped QA store. Copies the database (and WAL) first so the
inspection never changes the store the next API start recovers. Prints one JSON object."""
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile

data_dir = sys.argv[1]
scratch = tempfile.mkdtemp(prefix="gg-qa-412f-a-inspect-")
try:
    for suffix in ("", "-wal"):
        src = os.path.join(data_dir, "graphgoblin.db" + suffix)
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(scratch, "graphgoblin.db" + suffix))
    db = sqlite3.connect(os.path.join(scratch, "graphgoblin.db"))
    q = lambda sql: db.execute(sql).fetchall()
    out = {
        "runs": q("SELECT count(*) FROM runs")[0][0],
        "approved": q("SELECT count(*) FROM runs WHERE deletion_approval IS NOT NULL")[0][0],
        "events": q("SELECT count(*) FROM run_events")[0][0],
        "orphanEvents": q("SELECT count(*) FROM run_events WHERE run_id NOT IN (SELECT id FROM runs)")[0][0],
        "orphanSessions": q("SELECT count(*) FROM harness_sessions WHERE run_id NOT IN (SELECT id FROM runs)")[0][0],
        "orphanUses": q("SELECT count(*) FROM run_resource_uses WHERE run_id NOT IN (SELECT id FROM runs)")[0][0],
        "danglingParents": q("SELECT count(*) FROM runs WHERE parent_run_id IS NOT NULL AND parent_run_id NOT IN (SELECT id FROM runs)")[0][0],
        "danglingReplaySources": q("SELECT count(*) FROM runs WHERE replay_source_run_id IS NOT NULL AND replay_source_run_id NOT IN (SELECT id FROM runs)")[0][0],
        "resources": q("SELECT count(*) FROM run_resources")[0][0],
        "pendingResources": q("SELECT count(*) FROM run_resources WHERE pending = 1")[0][0],
        "pendingWithApproval": q("SELECT count(*) FROM run_resources WHERE pending = 1 AND approval IS NOT NULL")[0][0],
        "pendingWhoseRunExists": q("SELECT count(*) FROM run_resources WHERE pending = 1 AND owner_run_id IN (SELECT id FROM runs)")[0][0],
        "uses": q("SELECT count(*) FROM run_resource_uses")[0][0],
        "freelistBytes": q("PRAGMA freelist_count")[0][0] * q("PRAGMA page_size")[0][0],
        "pageBytes": q("PRAGMA page_count")[0][0] * q("PRAGMA page_size")[0][0],
        "integrity": q("PRAGMA integrity_check")[0][0],
        # Deterministic quarantine names of pending jobs (sha256 of key + identity, as ADR-0060).
        # Re-check adaptation: a staged job's key is "quarantine:<hash>:<original key>" (round 2),
        # and its quarantine directory is named after the ORIGINAL key plus identity.
        "pendingQuarantineNames": sorted(
            hashlib.sha256(((key[76:] if key.startswith("quarantine:") else key) + identity).encode("utf-8")).hexdigest()
            for key, identity in q("SELECT key, identity FROM run_resources WHERE pending = 1")
        ),
        "pendingKinds": dict(q("SELECT kind, count(*) FROM run_resources WHERE pending = 1 GROUP BY kind")),
        # Workspace reference obligations (migration 0022, ADR-0060), added for the re-check.
        "workspaceReferences": q("SELECT count(*) FROM workspace_references")[0][0],
        "workspaceReferencesUnknown": q("SELECT count(*) FROM workspace_references WHERE physical_path IS NULL")[0][0],
        "workspaceReferencesOrphanRun": q("SELECT count(*) FROM workspace_references WHERE run_id IS NOT NULL AND run_id NOT IN (SELECT id FROM runs)")[0][0],
        "workspaceReferencesOrphanVersion": q("SELECT count(*) FROM workspace_references WHERE version_id IS NOT NULL AND version_id NOT IN (SELECT id FROM loop_versions)")[0][0],
        "workspaceReferenceState": q("SELECT epoch, sweeping FROM workspace_reference_state")[0],
        "quarantinedJobs": q("SELECT count(*) FROM run_resources WHERE key LIKE 'quarantine:%'")[0][0],
    }
    db.close()
    print(json.dumps(out))
finally:
    pass  # Leave read-only inspection copies for the orchestrator.
