"""Count actual SQLite VM instructions for the event writer's last_event_seq UPDATE.

Uses the shipped migration SQL and sqlite3's public progress handler (one instruction
per callback), not elapsed time or a simulated trigger. Run from the repository root.
Temporary databases are disposable and removed by TemporaryDirectory.
"""
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory


def measure(size, resume=False):
    with TemporaryDirectory(prefix="gg-wp-e3-append-") as directory:
        db = sqlite3.connect(str(Path(directory) / "measurement.db"))
        folder = Path("packages/infrastructure/drizzle")
        journal = json.loads((folder / "meta/_journal.json").read_text())
        for entry in journal["entries"]:
            db.executescript((folder / (entry["tag"] + ".sql")).read_text())
        db.executemany(
            """INSERT INTO runs
            (id,owner_id,loop_id,version_id,invocation_id,status,iteration,
             created_at,initial_thread,finalized_at)
            VALUES (?, 'local', 'loop', 'version', 'inv', 'succeeded', 1,
                    '2026-10-25T00:00:00.000Z', '{}', '2026-10-25T00:00:00.000Z')""",
            ((str(i),) for i in range(size)),
        )
        approval = json.dumps({"confirmedAt": "2026-10-25T00:00:00.000Z",
                              "confirmedBy": {"ownerId": "local", "kind": "user", "id": "owner"}})
        if resume:
            # Many unrelated approved components must not enter this component's walk.
            db.execute("UPDATE runs SET deletion_approval=?", (approval,))
        else:
            db.execute("UPDATE runs SET deletion_approval=? WHERE id='1'", (approval,))
            db.execute("UPDATE runs SET status='running', finalized_at=NULL WHERE id='0'")
        db.commit()
        steps = 0

        def step():
            nonlocal steps
            steps += 1
            return 0

        # Prepare/warm once so preparation and automatic transaction work are excluded.
        statement = ("UPDATE runs SET status=? WHERE id=?" if resume
                     else "UPDATE runs SET last_event_seq=? WHERE id=?")
        db.execute(statement, ("succeeded" if resume else 1, "0"))
        db.set_progress_handler(step, 1)
        db.execute(statement, ("queued" if resume else 2, "0"))
        db.set_progress_handler(None, 0)
        assert db.execute("SELECT deletion_approval FROM runs WHERE id='1'").fetchone()[0] == approval
        db.close()
        return steps


results = {size: measure(size) for size in (100, 10000)}
print(json.dumps({"sqlite": sqlite3.sqlite_version, "vm_steps": results}))
if "--assert-bounded" in __import__("sys").argv:
    assert max(results.values()) <= 200, results
    assert len(set(results.values())) == 1, results
if "--measure-resume" in __import__("sys").argv:
    resume_results = {size: measure(size, resume=True) for size in (100, 10000)}
    print(json.dumps({"resume_vm_steps": resume_results}))
    assert max(resume_results.values()) <= 1000, resume_results
    assert len(set(resume_results.values())) == 1, resume_results
