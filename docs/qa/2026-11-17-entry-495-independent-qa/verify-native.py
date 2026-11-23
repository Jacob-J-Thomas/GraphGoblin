import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

EVIDENCE = Path(__file__).resolve().parent
CHECKOUT = Path(r"C:\Users\98jak\.codex\worktrees\gg-20261117-entry-495-qa\GraphGoblin")
BASE = "6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1"
SCRIPTS = (
    "tooling/perf/summary.mjs",
    "tooling/scripts/gen-docs.mjs",
    "tooling/scripts/check-migrations.mjs",
)
SUMMARY, DOCS, MIGRATIONS = SCRIPTS
DOC_NODES = CHECKOUT / "docs/reference/nodes.md"
DOC_API = CHECKOUT / "docs/reference/api.md"
SCHEMA = CHECKOUT / "packages/infrastructure/src/sqlite/schema.ts"
DRIZZLE = CHECKOUT / "packages/infrastructure/drizzle"
PNPM = shutil.which("pnpm.cmd")
NODE = shutil.which("node.exe")
ALIASES = (EVIDENCE / "junction", EVIDENCE / "junction résumé 雪")
EXPECTED_MODIFIED = sorted(SCRIPTS)
RECEIPTS = EVIDENCE / "receipts"
RECEIPTS.mkdir(exist_ok=False)
FIXTURES = EVIDENCE / "fixtures"
FIXTURES.mkdir(exist_ok=False)
cases = []
failures = []
linked = []


def json_file(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def describe(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": sha(data)}


def git(*arguments):
    return subprocess.check_output(["git", *arguments], cwd=CHECKOUT).decode("utf-8")


def run(case, argv, cwd, expected, contains=None, env=None):
    command = [str(value) for value in argv]
    completed = subprocess.run(command, cwd=cwd, capture_output=True, env=env, check=False)
    stdout = RECEIPTS / (case + ".stdout")
    stderr = RECEIPTS / (case + ".stderr")
    stdout.write_bytes(completed.stdout)
    stderr.write_bytes(completed.stderr)
    output = (completed.stdout + completed.stderr).decode("utf-8", errors="replace")
    combined = {"code": completed.returncode, "output": output}
    exit_ok = completed.returncode != 0 if expected == "nonzero" else completed.returncode == expected
    valid = exit_ok and (contains is None or contains in output)
    receipt = {
        "case": case,
        "argv": command,
        "cwd": str(cwd),
        "exit": completed.returncode,
        "expectedExit": expected,
        "expectedOutput": contains,
        "result": "PASS" if valid else "FAIL",
        "stdout": {"path": str(stdout.relative_to(EVIDENCE)), **describe(stdout)},
        "stderr": {"path": str(stderr.relative_to(EVIDENCE)), **describe(stderr)},
        "output": output.strip()[:650],
        "assertions": [],
    }
    cases.append(receipt)
    if not valid:
        failures.append(f"{case}: exit={completed.returncode} and output={output[:450]!r}")
    return receipt, combined


def demand(receipt, description, valid, artifact=None):
    result = {"assertion": description, "passed": bool(valid)}
    if artifact is not None:
        result["artifact"] = {"path": str(artifact), **describe(artifact)}
    receipt["assertions"].append(result)
    if not valid:
        receipt["result"] = "FAIL"
        failures.append(f"{receipt['case']}: {description}")


def inventory():
    files = [DOC_NODES, DOC_API, SCHEMA, *sorted(path for path in DRIZZLE.rglob("*") if path.is_file())]
    return {path.relative_to(CHECKOUT).as_posix(): describe(path) for path in files}


def create_junction(alias):
    assert alias.parent == EVIDENCE and not os.path.lexists(alias)
    command = (
        "$ErrorActionPreference='Stop'; "
        "$item=New-Item -ItemType Junction -Path $env:GG_QA_495_ALIAS "
        "-Target $env:GG_QA_495_TARGET; "
        "$item | Select-Object FullName,LinkType,Target | ConvertTo-Json -Compress"
    )
    env = {**os.environ, "GG_QA_495_ALIAS": str(alias), "GG_QA_495_TARGET": str(CHECKOUT)}
    completed = subprocess.run(
        ["pwsh", "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True, text=True, encoding="utf-8", env=env, check=True,
    )
    link = json.loads(completed.stdout)
    assert link["LinkType"] == "Junction"
    assert Path(link["Target"]).resolve(strict=True) == CHECKOUT
    assert alias.resolve(strict=True) == CHECKOUT
    linked.append(alias)
    return link


def remove_junction(alias):
    assert alias.parent == EVIDENCE
    assert os.lstat(alias).st_reparse_tag == 0xA0000003
    assert alias.resolve(strict=True) == CHECKOUT
    os.rmdir(alias)
    assert not os.path.lexists(alias) and CHECKOUT.is_dir()


def check_summary(receipt, output):
    if not output.is_file():
        demand(receipt, "summary file was written", False)
        return
    try:
        record = json.loads(output.read_bytes())
        measured = record["measurements"]
        workloads = [measurement["workload"] for measurement in measured]
        mapped = [(case["measurement"], case["wallMs"]) for case in record["cases"]]
        valid = (
            record["schema"] == 2
            and workloads == ["long", "context"]
            and [measurement["cases"] for measurement in measured] == [[0], [1]]
            and mapped == [(0, 19.125), (1, 22.5)]
            and record["ports"] == ["events.append"]
        )
    except (ValueError, KeyError, TypeError):
        valid = False
    demand(receipt, "portable schema 2, ordered workloads and cases, shared port index", valid, output)


def raw_measurement(workload, passes, milliseconds):
    return {
        "workload": workload, "aged": 0, "schema": 1,
        "cases": [{
            "specification": {"passes": passes},
            "wallMs": milliseconds,
            "timings": {"events.append": {"count": 1, "totalMs": 2}},
            "checkpoints": [],
            "correctness": {"ok": True, "passes": passes},
        }],
    }


def diagnostic_env():
    trace = FIXTURES / "entry-preload.mjs"
    trace.write_text(
        """
import { realpathSync } from 'node:fs';
if (process.argv[1]?.match(/(?:gen-docs|check-migrations|summary)\\.mjs$/)) {
  console.error(JSON.stringify({
    receipt: 'qa-entry-spelling',
    cwd: process.cwd(),
    argv1: process.argv[1],
    realEntry: realpathSync(process.argv[1]),
  }));
}
""".lstrip(),
        encoding="utf-8",
    )
    return {**os.environ, "NODE_OPTIONS": f"--import={trace.as_uri()}"}


def execute(before, original_nodes, original_schema):
    file_a = FIXTURES / "raw-first.json"
    file_b = FIXTURES / "raw-second.json"
    malformed = FIXTURES / "raw-malformed.json"
    json_file(file_a, raw_measurement("long", 7, 19.125))
    json_file(file_b, [raw_measurement("context", 9, 22.5)])
    malformed.write_bytes(b'{"workload":"bad",\n')

    pnpm_modes = (("real", CHECKOUT), ("junction", ALIASES[0]), ("unicode-junction", ALIASES[1]))
    direct_modes = (
        ("real-relative", CHECKOUT, None),
        ("junction-relative", ALIASES[0], None),
        ("junction-absolute", CHECKOUT, ALIASES[0]),
        ("unicode-junction-absolute", CHECKOUT, ALIASES[1]),
    )

    def entry(script, prefix):
        return (prefix / script) if prefix else script

    # The gate build is the only compilation needed by these QA commands.
    run("prerequisite-contracts-build", [PNPM, "--filter", "@graphgoblin/contracts", "build"], CHECKOUT, 0, "tsc")
    assert (CHECKOUT / "packages/contracts/dist/index.js").is_file()
    for tag, cwd in pnpm_modes:
        run("pnpm-docs-positive-" + tag, [PNPM, "check:docs"], cwd, 0, "Generated docs are up to date.")
        run("pnpm-migrations-positive-" + tag, [PNPM, "check:migrations"], cwd, 0, "Drizzle generation is a no-op.")

    # Inject two meaningful invalid inputs, alongside an independently malformed raw perf record.
    DOC_NODES.write_bytes(original_nodes + b"\n<!-- Independent QA stale reference sentinel 495 -->\n")
    SCHEMA.write_bytes(original_schema + b"\nexport const independentQa495 = sqliteTable('qa_495_entry_probe', {\n  id: integer('id').primaryKey(),\n});\n")
    seeded = inventory()
    json_file(EVIDENCE / "protected-fixtures-seeded.json", seeded)
    for tag, cwd in pnpm_modes:
        report, _ = run("pnpm-docs-negative-" + tag, [PNPM, "check:docs"], cwd, 1, r"Generated docs are out of date: docs\reference\nodes.md")
        demand(report, "check left stale reference bytes in place", inventory()[DOC_NODES.relative_to(CHECKOUT).as_posix()] == seeded[DOC_NODES.relative_to(CHECKOUT).as_posix()])
        report, _ = run("pnpm-migrations-negative-" + tag, [PNPM, "check:migrations"], cwd, 1, "Schema/snapshot drift: drizzle-kit would write")
        demand(report, "shipped migration directory and seeded schema unchanged", inventory() == seeded)

    for tag, cwd, prefix in direct_modes:
        report, _ = run("direct-docs-negative-" + tag, [NODE, entry(DOCS, prefix), "--check"], cwd, 1, r"Generated docs are out of date: docs\reference\nodes.md")
        demand(report, "check left stale reference bytes in place", describe(DOC_NODES) == seeded[DOC_NODES.relative_to(CHECKOUT).as_posix()])
        report, _ = run("direct-migrations-negative-" + tag, [NODE, entry(MIGRATIONS, prefix)], cwd, 1, "Schema/snapshot drift: drizzle-kit would write")
        demand(report, "shipped migration directory and seeded schema unchanged", inventory() == seeded)
        malformed_output = FIXTURES / ("unexpected-" + tag + ".json")
        report, _ = run("direct-summary-malformed-" + tag, [NODE, entry(SUMMARY, prefix), f"--out={malformed_output}", file_a, malformed], cwd, "nonzero", "SyntaxError")
        demand(report, "malformed second input left no partial aggregate", not malformed_output.exists())

    # Forge CLI-looking argv[1] to match each real script while a different module is the process entry.
    probe = FIXTURES / "import-with-cli-argv.mjs"
    probe.write_text(
        """
import { pathToFileURL } from 'node:url';
const [modulePath, ...args] = process.argv.slice(2);
process.argv = [process.execPath, modulePath, ...args];
const namespace = await import(pathToFileURL(modulePath).href);
console.log(JSON.stringify(Object.keys(namespace).sort()));
""".lstrip(),
        encoding="utf-8",
    )
    for tag, prefix in (("real", CHECKOUT), ("unicode-junction", ALIASES[1])):
        import_docs_target = FIXTURES / ("unexpected-docs-import-" + tag)
        import_summary_target = FIXTURES / ("unexpected-summary-import-" + tag + ".json")
        for kind, path, args, exports, unexpected in (
            ("docs", DOCS, ["--output", import_docs_target], ["OUTPUTS", "generate", "staleFiles"], import_docs_target),
            ("migrations", MIGRATIONS, [], ["checkJournal", "checkMigrations"], None),
            ("summary", SUMMARY, [f"--out={import_summary_target}", file_a, file_b], ["summarize"], import_summary_target),
        ):
            report, result = run(f"import-{kind}-{tag}", [NODE, probe, prefix / path, *args], prefix, 0)
            expected = json.dumps(exports, separators=(",", ":"))
            demand(report, "only expected exports printed, no CLI output", result["output"].strip() == expected)
            if unexpected is not None:
                demand(report, "CLI output path remains absent", not unexpected.exists())
            demand(report, "protected fixtures preserve seeded bytes", inventory() == seeded)

    # Observe actual argv/cwd separately so the positive and negative controls above stay uninstrumented.
    trace_env = diagnostic_env()
    for tag, cwd in pnpm_modes:
        for kind, script, marker in (
            ("docs", "check:docs", "Generated docs are out of date:"),
            ("migrations", "check:migrations", "Schema/snapshot drift:"),
        ):
            result, captured = run(f"trace-pnpm-{kind}-{tag}", [PNPM, script], cwd, 1, marker, trace_env)
            demand(result, "entry spelling was captured", "qa-entry-spelling" in captured["output"])
    for tag, cwd, prefix in direct_modes:
        result, captured = run("trace-direct-docs-" + tag, [NODE, entry(DOCS, prefix), "--check"], cwd, 1, "Generated docs are out of date:", trace_env)
        demand(result, "entry spelling was captured", "qa-entry-spelling" in captured["output"])

    DOC_NODES.write_bytes(original_nodes)
    SCHEMA.write_bytes(original_schema)
    assert inventory() == before, "restored fixtures did not match original hashes"

    for tag, cwd, prefix in direct_modes:
        run("direct-docs-positive-" + tag, [NODE, entry(DOCS, prefix), "--check"], cwd, 0, "Generated docs are up to date.")
        run("direct-migrations-positive-" + tag, [NODE, entry(MIGRATIONS, prefix)], cwd, 0, "Drizzle generation is a no-op.")
        generated = FIXTURES / ("generated-" + tag)
        report, _ = run("direct-docs-write-" + tag, [NODE, entry(DOCS, prefix), "--output", generated], cwd, 0, "wrote")
        for original in (DOC_NODES, DOC_API):
            artifact = generated / original.name
            matches = artifact.is_file() and artifact.read_bytes() == original.read_bytes().replace(b"\r\n", b"\n")
            demand(report, f"{original.name} matches current reference after CRLF/LF normalization", matches, artifact if artifact.is_file() else None)
        output = FIXTURES / ("summary-" + tag + ".json")
        report, _ = run("direct-summary-positive-" + tag, [NODE, entry(SUMMARY, prefix), f"--out={output}", file_a, file_b], cwd, 0)
        check_summary(report, output)

    baseline = FIXTURES / "baseline"
    baseline.mkdir()
    for file in (SUMMARY, "tooling/perf/common.mjs"):
        target = baseline / Path(file).name
        target.write_bytes(subprocess.check_output(["git", "show", f"{BASE}:{file}"], cwd=CHECKOUT))
    json_file(EVIDENCE / "baseline-source.json", {p.name: describe(p) for p in baseline.iterdir()})
    # A file inside the QA worktree's existing junction target gives the unmodified baseline a true alias.
    # Copy it to a separate directory under the checkout's ignored node_modules, away from tracked files.
    baseline_name = "graphgoblin-independent-495-baseline"
    temporary = CHECKOUT / "node_modules" / baseline_name
    assert not temporary.exists() and temporary.parent == CHECKOUT / "node_modules"
    temporary.mkdir()
    for source in baseline.iterdir():
        (temporary / source.name).write_bytes(source.read_bytes())
    try:
        real_entry = temporary / "summary.mjs"
        alias_entry = ALIASES[1] / "node_modules" / baseline_name / "summary.mjs"
        output = FIXTURES / "baseline-real-summary.json"
        report, _ = run("base-summary-real", [NODE, real_entry, f"--out={output}", file_a, file_b], CHECKOUT, 0)
        check_summary(report, output)
        missing = FIXTURES / "baseline-unexpected-alias-summary.json"
        report, captured = run("base-summary-junction-before-fix", [NODE, alias_entry, f"--out={missing}", file_a, file_b], CHECKOUT, 0)
        demand(report, "historical silent skip reproduced by missing output and empty stdout/stderr", not missing.exists() and not captured["output"])
        report, captured = run("trace-base-summary-junction", [NODE, alias_entry, f"--out={missing}", file_a, file_b], CHECKOUT, 0, "qa-entry-spelling", trace_env)
        diagnostic = json.loads(captured["output"].strip())
        demand(report, "baseline lexical argv entry differs from canonical loader path", diagnostic["argv1"] != diagnostic["realEntry"])
    finally:
        for name in ("summary.mjs", "common.mjs"):
            (temporary / name).unlink()
        temporary.rmdir()


def main():
    assert Path.cwd() == CHECKOUT and CHECKOUT.resolve(strict=True) == CHECKOUT
    assert git("rev-parse", "HEAD").strip() == BASE
    changed = git("status", "--porcelain=v1", "--untracked-files=all")
    assert sorted(line[3:] for line in changed.splitlines() if line.startswith(" M ")) == EXPECTED_MODIFIED
    assert len(changed.splitlines()) == len(EXPECTED_MODIFIED)
    assert NODE and PNPM and not os.environ.get("NODE_OPTIONS")
    assert subprocess.check_output([NODE, "--version"]).strip() == b"v22.23.4"
    expected = json.loads((EVIDENCE / "source-before.json").read_text(encoding="utf-8-sig"))
    assert [dict(path=item["path"], **describe(CHECKOUT / item["path"])) for item in expected] == expected
    before = inventory()
    json_file(EVIDENCE / "protected-fixtures-before.json", before)
    original_nodes = DOC_NODES.read_bytes()
    original_schema = SCHEMA.read_bytes()
    context_error = None
    try:
        links = [create_junction(alias) for alias in ALIASES]
        json_file(EVIDENCE / "junctions.json", links)
        execute(before, original_nodes, original_schema)
    except BaseException as exc:
        context_error = repr(exc)
        raise
    finally:
        if DOC_NODES.read_bytes() != original_nodes:
            DOC_NODES.write_bytes(original_nodes)
        if SCHEMA.read_bytes() != original_schema:
            SCHEMA.write_bytes(original_schema)
        for alias in reversed(linked):
            remove_junction(alias)
        after = inventory()
        sources = [dict(path=item["path"], **describe(CHECKOUT / item["path"])) for item in expected]
        final_status = git("status", "--porcelain=v1", "--untracked-files=all")
        json_file(EVIDENCE / "protected-fixtures-after.json", after)
        json_file(EVIDENCE / "source-after.json", sources)
        (EVIDENCE / "git-status-after.txt").write_text(final_status, encoding="utf-8")
        cleanup = {
            "matchesProtectedFixtureHashes": before == after,
            "matchesFrozenScriptHashes": expected == sources,
            "matchesInitialGitStatus": final_status == changed,
            "temporaryJunctionsRemoved": all(not os.path.lexists(alias) for alias in ALIASES),
            "repositoryHead": git("rev-parse", "HEAD").strip(),
        }
        verdict = "INCOMPLETE" if context_error else "FAIL" if failures or not all(list(cleanup.values())[:4]) else "PASS"
        json_file(EVIDENCE / "matrix.json", {
            "verdict": verdict, "checkout": str(CHECKOUT), "node": NODE, "pnpm": PNPM,
            "infrastructureError": context_error, "failures": failures, "cleanup": cleanup,
            "cases": cases,
        })
        print(f"{verdict} across {len(cases)} commands, {len(failures)} case assertion failures")
        for failure in failures:
            print(failure)
    return verdict != "PASS"


if __name__ == "__main__":
    sys.exit(main())
