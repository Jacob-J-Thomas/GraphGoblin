"""Read-only: copy a stopped store and print its workspace reference obligations with the owning
run's status (migration 0022, ADR-0060). Usage: python -I refs-dump.py <dataDir>"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile

data_dir = sys.argv[1]
scratch = tempfile.mkdtemp(prefix="gg-qa-e3r-refs-")
try:
    for suffix in ("", "-wal"):
        src = os.path.join(data_dir, "graphgoblin.db" + suffix)
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(scratch, "graphgoblin.db" + suffix))
    db = sqlite3.connect(os.path.join(scratch, "graphgoblin.db"))
    rows = db.execute(
        "SELECT w.id, w.run_id, r.status, w.version_id, w.path, w.physical_path FROM workspace_references w "
        "LEFT JOIN runs r ON r.id = w.run_id ORDER BY w.id"
    ).fetchall()
    out = {
        "migrations": db.execute("SELECT count(*) FROM __drizzle_migrations").fetchone()[0],
        "state": db.execute("SELECT epoch, sweeping FROM workspace_reference_state").fetchone(),
        "references": [
            {"kind": rid.split(":")[0], "run": run, "runStatus": status, "version": version, "path": path, "physical": physical}
            for rid, run, status, version, path, physical in rows
        ],
    }
    db.close()
    print(json.dumps(out))
finally:
    shutil.rmtree(scratch, ignore_errors=True)
