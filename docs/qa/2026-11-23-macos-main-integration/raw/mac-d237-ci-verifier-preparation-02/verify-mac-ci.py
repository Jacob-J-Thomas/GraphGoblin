"""Verify one current, first-attempt GraphGoblin PR CI run and its hosted artifacts."""
from argparse import ArgumentParser
from base64 import b64decode
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha1, sha256
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
from zipfile import ZipFile

REPO = "Jacob-J-Thomas/GraphGoblin"
WORKFLOW = ".github/workflows/ci.yml"
WORKFLOW_SHA = "e64133d66dbd3506db5f9c6e371abd964488cab89922c5934cea7d7b1021c778"
SWIFT = "apps/macos-launcher/"
WINDOWS = "tooling/scripts/windows-launcher-evidence.mjs"
MAC_DRIVER = "tooling/scripts/macos-launcher.acceptance.mjs"
REPLAY_SHA = "b1b9a7b02e24d63ebf7d39504a73b560e2ac7b3e7565d4122b2f10d6adf99bf3"
JOBS = {
    "macOS launcher": ("Install", "Build", "Record native toolchain", "Mac API integration tests",
                       "Swift native tests and coverage thresholds",
                       "Native macOS installer and gateway acceptance", "Upload native evidence"),
    "Windows launcher": ("Install", "Build", "Prepare native evidence", "Native Windows launcher acceptance",
                         "Finalize native evidence", "Upload native evidence"),
    "Repository checks": ("Install (frozen lockfile)", "Build", "Reset acceptance", "Recovery process acceptance",
                          "Chat restart acceptance", "Wait restart acceptance", "Prompt restart acceptance",
                          "Webhook retry acceptance", "Current-format migration acceptance", "Typecheck", "Lint",
                          "Format check", "Layer rules", "Migration generation is a no-op", "Design token rules",
                          "Dependency graph rules", "Shipped templates and deliberate-invalid refusal",
                          "Licence allowlist", "Generated docs are current",
                          "Design token contrast table is current and passing", "Dependency audit"),
    "Coverage": ("Install (frozen lockfile)", "Build", "Install Chromium for tooling browser measurements",
                 "Unit tests with coverage thresholds", "Upload coverage reports", "Coverage report status"),
    "Gates": ("Require Repository checks and Coverage to succeed",),
    "Browser": ("Install (frozen lockfile)", "Install Edge", "Build", "Functional browser suite (no retries)",
                "Browser coverage and exclusions"),
    "Template image": ("Build the distributed image", "Load installed templates without network or writable storage"),
}
WORKSPACES = {
    "apps/api", "apps/mcp", "apps/plugin-claude", "apps/plugin-codex", "apps/web", "packages/adapter-codex",
    "packages/adapter-jev", "packages/api-client", "packages/contracts", "packages/domain", "packages/engine",
    "packages/infrastructure", "tooling",
}
V8 = {f"{p}/coverage/coverage-summary.json" for p in WORKSPACES}
METRICS = ("lines", "regions", "branches")
TARGETS = {
    "LaunchContract": (".", "library"), "LauncherEngine": ("Engine", "library"),
    "LauncherPresentation": ("Presentation", "library"), "LauncherEntry": (".", "executable"),
    "LauncherInstaller": ("Installer/Core", "library"), "InstallerEntry": ("Installer", "executable"),
}
ENTRY = {"Entry.swift": "LauncherEntry", "Installer/Entry.swift": "InstallerEntry"}
DECLARATIONS = {
    "LaunchContract.swift": "60cde1d6d8d64bfe42b316b174c70c7d71f5fea1070c8f27cc0fb78aaff75fdc",
    "Presentation/PresentationSeams.swift": "870aeff6f1eda291bd9532b1c401569ede7c1f9e548464f3b12807512a5e3201",
}
BRANCH_TESTS = {
    "LauncherEngineTests.InstalledEngineTests/foreignHealthPreventsSpawnAndRecordsOnlyTheClosedRefusal()/InstalledEngineTests.swift",
    "LauncherEngineTests.InstalledEngineTests/warmShutdownModeUsesBoundShellsWithoutStartingAChild()/InstalledEngineTests.swift",
    "LauncherEngineTests.InstalledEngineTests/coldCommitBindsDirectChildAndWarmAttemptKeepsItsPID()/InstalledEngineTests.swift",
    "LauncherInstallerTests.InstallerRecoveryTests/heldApplicationsLockRefusesInstallWithoutCreatingADestination()/InstallerRecoveryTests.swift",
    "LauncherPresentationTests.ChildCompositionTests/panelQuitAfterGrace()/ChildCompositionTests.swift",
    "LauncherPresentationTests.ChildCompositionTests/failureThenOK()/ChildCompositionTests.swift",
}
NATIVE_MEMBERS = {"manifest.json": 8192, "observations.ndjson": 196608, "result.json": 16384}
MAC_PROCESSES = {
    "checked-out-head": 0, "public-install": 0, "foreign-port": 20, "missing-local-key": 13,
    "cold-attempt-one": 0, "cold-attempt-two": 0, "post-shell-owner": 0, "warm": 0,
    "api-physical-log-contention": 70, "api-managed-key-recheck": 74, "public-managed-replacement": 0,
    "held-store": 21, "drain-rebound": 0, "store-state-free": 0,
}


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def uid(value):
    return type(value) is int and value > 0


def hex40(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def digest(data):
    return sha256(data).hexdigest()


def store(root, name, data):
    with (root / name).open("xb") as file:
        file.write(data)


def record(root, name, obj):
    store(root, name, (json.dumps(obj, indent=2) + "\n").encode("utf-8"))


def get(route):
    return subprocess.check_output(["gh", "api", f"repos/{REPO}/{route}"], timeout=120)


def retain(root, route, name):
    raw = get(route)
    store(root, name, raw)
    return json.loads(raw)


def source_id(pr, target, head, repo_id):
    return (pr["head"]["sha"], pr["base"]["sha"], pr["base"]["ref"],
            pr["head"]["repo"]["id"], pr["base"]["repo"]["id"]) == (head, target, "main", repo_id, repo_id)


def require_current(pr, ref, number, head, target, merge, repo_id):
    require(pr["number"] == number and pr["state"] == "open" and pr["merged"] is False
            and source_id(pr, target, head, repo_id) and pr["merge_commit_sha"] == merge
            and ref["ref"] == "refs/heads/main" and ref["object"]["sha"] == target,
            "Current open PR, tested merge, or main target changed")


def check_run(run, pr, ref, number, run_id, head, target):
    repo_id = run["repository"]["id"]
    require(run["repository"]["full_name"] == REPO and run["path"] == WORKFLOW
            and (run["id"], run["run_attempt"], run["event"], run["status"], run["conclusion"], run["head_sha"])
            == (run_id, 1, "pull_request", "completed", "success", head), "Wrong or unsuccessful first CI attempt")
    attached = run["pull_requests"]
    require(len(attached) == 1 and attached[0]["number"] == number
            and source_id(attached[0], target, head, repo_id), "Run does not bind the exact PR and target")
    merge = pr["merge_commit_sha"]
    require(hex40(merge), "Missing tested merge object")
    require_current(pr, ref, number, head, target, merge, repo_id)
    return merge, repo_id


def check_jobs(data, run_id, head):
    rows = data["jobs"]
    require(data["total_count"] == len(rows) == len(JOBS) and {r["name"] for r in rows} == JOBS.keys()
            and len({r["id"] for r in rows}) == len(JOBS), "Expected exactly seven distinct current CI jobs")
    jobs = {}
    for job in rows:
        name = job["name"]
        require(uid(job["id"]) and (job["run_id"], job["run_attempt"], job["head_sha"], job["status"], job["conclusion"])
                == (run_id, 1, head, "completed", "success"), f"Invalid job binding or outcome: {name}")
        steps = {s["name"]: s for s in job["steps"]}
        required = JOBS[name] + (("Run actions/checkout@v4",) if name != "Gates" else ())
        require(len(steps) == len(job["steps"]) and all(s in steps for s in required)
                and all((steps[s]["status"], steps[s]["conclusion"]) == ("completed", "success") for s in required),
                f"Required step missing or unsuccessful: {name}")
        bad = [s["name"] for s in job["steps"] if s["conclusion"] in {"failure", "cancelled", "timed_out"}]
        require(not bad, f"Unsuccessful step: {name}: {bad}")
        jobs[name] = {"job": job["id"], "conclusion": "success", "failedOrCancelledSteps": bad}
    return jobs


def log_text(raw):
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", raw.decode("utf-8-sig"))
    return re.sub(r"^\d{4}-\d\d-\d\dT\S+Z ", "", text.replace("\r\n", "\n"), flags=re.M)


def check_logs(logs, merge):
    for name, log in logs.items():
        if name != "Gates":
            git = re.findall(r"^\[command\][^\n]+git(?:\.exe\")? log -1 --format=%H\n([0-9a-f]{40})$", log, re.M)
            require(git == [merge], f"Checkout did not report the tested merge: {name}")
    require("Repository checks: success; Coverage: success" in logs["Gates"], "Combined Gates results unavailable")
    audit = logs["Repository checks"].partition("##[group]Run pnpm audit --audit-level=high")[2]
    severity = re.findall(r"^Severity: (.+)$", audit, re.M)
    letters = r"\d+ (?:low|moderate|high|critical)"
    require(audit and ((len(severity) == 1 and re.fullmatch(fr"{letters}(?: \| {letters})*", severity[0])
                       and not re.search(r"\b[1-9]\d* (?:high|critical)\b", severity[0]))
                      or (not severity and "No known vulnerabilities found" in audit)), "High/critical audit gate absent or failed")
    coverage = logs["Coverage"]
    counts = re.findall(r"^ *Tests\s+(\d+) passed(?: \| (\d+) skipped)?", coverage, re.M)
    require(len(counts) == len(V8) and all(int(passed) > 0 for passed, _ in counts)
            and "22 successful, 22 total" in coverage, "Incomplete serial V8 test results")
    browser = logs["Browser"]
    command = "pnpm exec playwright test --retries=0 --workers=1"
    browser_env = browser.partition(f"##[group]Run {command}\n")[2].partition("##[endgroup]")[0]
    passed = re.findall(r"^\s*([1-9]\d*) passed \([^)\n]+\)$", browser, re.M)
    skips = re.findall(r"^ *- +\d+ \[[^]]+\] › ([^\n]+)", browser, re.M)
    require(re.search(r"^ +GG_E2E_BROWSER_CHANNEL: msedge$", browser_env, re.M)
            and re.search(r"^ +LIVE: 0$", browser_env, re.M) and len(passed) == 1
            and re.findall(r"^Running (\d+) tests using 1 worker$", browser, re.M) == [str(int(passed[0]) + 1)]
            and re.findall(r"^ *(\d+) skipped$", browser, re.M) == ["1"]
            and len(skips) == 1 and re.fullmatch(r"e2e/live\.spec\.ts:\d+:\d+ › LIVE: build, publish, and run an inference loop against Codex from the UI", skips[0])
            and not re.search(r"^\s*[1-9]\d* (?:failed|flaky|did not run)\b|\(retry #\d+\)", browser, re.M),
            "Unexpected browser channel, options, skips, failures or retries")
    windows = logs["Windows launcher"]
    native_pass = re.findall(r"^# pass ([1-9]\d*)$", windows, re.M)
    require(native_pass and re.findall(r"^# fail (\d+)$", windows, re.M) == ["0"], "Native Windows result unsuccessful")
    template = re.findall(r'^\{"template":"([^"]+)","version":"[^"]+","draftNodes":[1-9]\d*\}$',
                          logs["Template image"], re.M)
    require(sorted(template) == ["implementation", "qa", "review", "starter"], "Missing shipped template observations")
    return {"unitPassed": sum(int(p) for p, _ in counts), "unitSkipped": sum(int(s or 0) for _, s in counts),
            "browserPassed": int(passed[0]), "browserSkipped": ["apps/web/e2e/live.spec.ts"],
            "nativeWindowsPassed": int(native_pass[-1]), "audit": severity[0] if severity else "no known vulnerabilities"}


def zip_members(z, max_bytes):
    members = z.infolist()
    require(len(members) <= 1000 and sum(m.file_size for m in members) <= max_bytes, "Archive exceeds evidence bound")
    names = set()
    for m in members:
        parts = m.filename.split("/")
        require(not m.is_dir() and not stat.S_ISLNK(m.external_attr >> 16) and not m.flag_bits & 1
                and all(p not in {"", ".", ".."} and not re.search(r"[\\:\x00-\x1f]", p) for p in parts)
                and m.filename not in names, f"Unsafe or duplicate archive member: {m.filename}")
        names.add(m.filename)
    require(z.testzip() is None, "Archive CRC differs")
    return names


def artifacts(data, run_id, head, repo_id):
    rows = data["artifacts"]
    expected = {"coverage", "windows-launcher-1", "macos-launcher"}
    require(data["total_count"] == len(rows) == len(expected) and {a["name"] for a in rows} == expected
            and len({a["id"] for a in rows}) == len(expected), "Missing or unexpected artifact ID/name")
    for a in rows:
        run = a["workflow_run"]
        require(uid(a["id"]) and uid(a["size_in_bytes"]) and a["size_in_bytes"] <= 64 * 1024**2
                and a["expired"] is False and (run["id"], run["head_sha"], run["repository_id"], run["head_repository_id"])
                == (run_id, head, repo_id, repo_id), f"Unbound or expired artifact: {a['name']}")
    return {a["name"]: a for a in rows}


def archive(root, artifact, log, name):
    raw = get(f"actions/artifacts/{artifact['id']}/zip")
    store(root, name, raw)
    sha = digest(raw)
    require(len(raw) == artifact["size_in_bytes"] and artifact["digest"] == "sha256:" + sha
            and f"SHA256 digest of uploaded artifact zip is {sha}" in log
            and re.search(rf"Artifact ID(?: is|\s*:)? {artifact['id']}\b", log), "Artifact digest, length, or uploader binding differs")
    return raw


def coverage_v8(raw):
    with ZipFile(BytesIO(raw)) as z:
        require(zip_members(z, 32 * 1024**2) == V8, "Expected exact 13 workspace coverage summaries")
        summaries = {}
        for name in sorted(V8):
            data = z.read(name)
            totals = json.loads(data)["total"]
            values = {k: totals[k]["pct"] for k in ("lines", "branches", "functions", "statements")}
            require(all(type(v) in (int, float) and 90 <= v <= 100 for v in values.values()),
                    f"Failed or malformed V8 threshold: {name}")
            summaries[name] = {"sha256": digest(data), **values}
        return summaries


def blobs(tree, paths):
    rows = {r["path"]: r for r in tree["tree"]}
    require(tree["truncated"] is False and len(rows) == len(tree["tree"])
            and paths <= rows.keys(), "Incomplete tested tree listing")
    def load(path):
        row = rows[path]
        require(row["type"] == "blob" and row["mode"] in {"100644", "100755"}
                and hex40(row["sha"]), f"Missing regular tested blob: {path}")
        obj = json.loads(get("git/blobs/" + row["sha"]))
        require(obj["encoding"] == "base64", f"Unexpected Git blob encoding: {path}")
        raw = b64decode("".join(obj["content"].split()), validate=True)
        git_sha = sha1(f"blob {len(raw)}\0".encode("ascii") + raw).hexdigest()
        require(obj["sha"] == row["sha"] == git_sha and obj["size"] == row["size"] == len(raw),
                f"Git blob bytes differ: {path}")
        return path, raw
    with ThreadPoolExecutor(max_workers=4) as workers:
        return dict(workers.map(load, sorted(paths)))


def production_path(path):
    return path.endswith(".swift") and not path.startswith("Tests/") and path != "Package.swift"


def swift_inventory(z, prefix, git_sources):
    def read(name):
        return json.loads(z.read(prefix + name))
    tracked_raw = z.read(prefix + "tracked-swift-files.stdout").decode("utf-8")
    tracked = tracked_raw.split("\0")
    require(tracked.pop() == "" and len(tracked) == len(set(tracked))
            and set(tracked) == {p for p in git_sources if p.endswith(".swift")}, "Tracked Swift roster differs from Git")
    paths = {p for p in tracked if production_path(p)}
    require(len(paths) == 25, "Current Swift production roster changed")
    description = read("package-description.stdout")
    package = description["path"]
    require(PurePosixPath(package).is_absolute() and package.endswith("/" + SWIFT.rstrip("/")), "Invalid Swift package path")
    targets = [r for r in description["targets"] if r["name"] in TARGETS]
    require(len(targets) == len(TARGETS) and {r["name"] for r in targets} == TARGETS.keys(), "Incomplete production targets")
    expected_products = {
        "GraphGoblin": "LauncherEntry", "GraphGoblinLauncherInstaller": "InstallerEntry",
    }
    for product, entry in expected_products.items():
        found = [r for r in description["products"] if r["name"] == product]
        require(len(found) == 1 and found[0]["targets"] == [entry] and "executable" in found[0]["type"],
                f"Missing canonical executable product: {product}")
    source_targets = {}
    for target in targets:
        name = target["name"]
        directory, kind = TARGETS[name]
        require((target["path"], target["type"]) == (directory, kind) and target["sources"],
                f"Unexpected Swift target shape: {name}")
        for basename in target["sources"]:
            path = (PurePosixPath(directory) / basename).as_posix()
            require(path in paths and path not in source_targets, f"Invalid Swift source/target membership: {path}")
            source_targets[path] = name
    require(source_targets.keys() == paths and all(source_targets[p] == n for p, n in ENTRY.items()),
            "Incomplete production mappings or executable source membership")
    values = read("production-sources.json")
    actual = {r["path"]: (r["target"], r["sha256"]) for r in values}
    expected = {p: (t, digest(git_sources[p])) for p, t in source_targets.items()}
    fixture = read("presentation-fixture-source.json")
    fixture_src = git_sources["Tests/PresentationFixture/PresentationFixture.swift"]
    require(len(actual) == len(values) and actual == expected
            and fixture["target"] == "PresentationFixture"
            and fixture["path"] == package + "/Tests/PresentationFixture/PresentationFixture.swift"
            and fixture["size"] == len(fixture_src) and fixture["sha256"] == digest(fixture_src),
            "Swift coverage source digests differ from Git")
    return read, package, expected


def metric_counts(value):
    pair = (value["count"], value["covered"])
    require(all(type(n) is int for n in pair) and 0 <= pair[1] <= pair[0], "Invalid coverage count")
    return pair


def llvm_rows(export, directory):
    require(export["type"] == "llvm.coverage.json.export" and export["version"] == "2.0.1"
            and len(export["data"]) == 1, "Unexpected LLVM export")
    rows = {}
    for file in export["data"][0]["files"]:
        fname = file["filename"]
        require(PurePosixPath(fname).is_absolute(), "LLVM filename is not bound to an absolute path")
        if not fname.startswith(directory + "/"):
            continue
        path = fname.removeprefix(directory + "/")
        if path.startswith("Tests/"):
            continue
        require(path not in rows, f"Duplicate LLVM source: {path}")
        rows[path] = {name: metric_counts(file["summary"][name]) for name in METRICS}
    return rows


def swift_coverage(read, package, expected):
    zero = dict.fromkeys(METRICS, (0, 0))
    baseline = llvm_rows(read("swift-zero-baseline.stdout"), package)
    observed = llvm_rows(read("swift-coverage.stdout"), package)
    require(baseline.keys() == observed.keys() <= expected.keys(), "LLVM zero/observed source roster differs")
    report = read("coverage-summary.json")
    files = {f["path"]: f for f in report["files"]}
    require(len(files) == len(report["files"]) and files.keys() == expected.keys(), "Swift summary roster differs")
    targets = {target: dict.fromkeys(METRICS, (0, 0)) for target in TARGETS}
    totals = dict.fromkeys(METRICS, (0, 0))
    for path, (target, sha) in expected.items():
        row = observed.get(path, zero)
        original = baseline.get(path, zero)
        mapped = row["lines"][0] > 0 and row["regions"][0] > 0
        require(mapped or (original == zero and DECLARATIONS.get(path) == sha),
                f"No executable coverage for production source: {path}")
        require(path not in ENTRY or mapped, f"No executable entry coverage: {path}")
        f = files[path]
        require((f["target"], f["sha256"], f["mapping"]) == (target, sha, "executable" if mapped else "declaration-only"),
                f"Reported coverage mapping differs: {path}")
        for name, (count, covered) in row.items():
            require(original[name] == (count, 0) and metric_counts(f[name]) == (count, covered),
                    f"Baseline/observed coverage differs: {path} {name}")
            for group in (targets[target], totals):
                group[name] = (group[name][0] + count, group[name][1] + covered)
    require(report["targets"].keys() == targets.keys(), "Unexpected Swift coverage target summary")
    for reported, calculated in [(report["totals"], totals), *((report["targets"][t], v) for t, v in targets.items())]:
        require({m: metric_counts(reported[m]) for m in METRICS} == calculated, "Swift coverage summary arithmetic differs")
    require(all(n > 0 and c * 100 >= n * 90 for n, c in (totals["lines"], totals["regions"]))
            and report["meetsThreshold"] is True and report["nativeBranchesAvailable"] is (totals["branches"][0] > 0),
            "Swift line or region threshold failed")
    return report["totals"]



def swift_command(z, prefix, label, cwd, args, clean_stderr=False, timeout=30_000):
    name = prefix + label
    require(name + ".json" in z.namelist(), f"Missing Swift command receipt: {label}")
    receipt = json.loads(z.read(name + ".json"))
    require(receipt["executable"] == "/usr/bin/xcrun" and receipt["cwd"] == cwd
            and receipt["args"] == ["--sdk", "macosx", *args] and receipt["timeout"] == timeout
            and type(receipt["status"]) is int and receipt["status"] == 0
            and receipt["signal"] is None and receipt["error"] is None,
            f"Failed or misbound Swift command: {label}")
    for stream in ("stdout", "stderr"):
        raw = z.read(name + "." + stream)
        require(receipt[stream] == {"size": len(raw), "sha256": digest(raw)}
                and (not clean_stderr or stream != "stderr" or not raw),
                f"Swift command stream differs: {label}.{stream}")


def path_witnesses(rows, paths):
    return [row["path"] for row in rows] == paths and all(
        uid(row["size"]) and re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) for row in rows
    )


def swift_profiles(z, prefix, read, package):
    scratch = read("swift-tests.json")["cwd"]
    evidence = read("profile-inputs.json")
    objects = evidence["objects"]
    test_name = "GraphGoblinMacLauncherPackageTests"
    debug = PurePosixPath(objects[0]["path"]).parents[3].as_posix()
    test_bundle = debug + f"/{test_name}.xctest/Contents/MacOS/{test_name}"
    launcher, installer, child = (debug + "/" + name for name in ("GraphGoblin", "GraphGoblinLauncherInstaller", "PresentationFixture"))
    object_paths = [test_bundle, launcher, installer, child]
    require(debug.startswith(scratch + "/swift-test/") and PurePosixPath(debug).name == "debug"
            and path_witnesses(objects, object_paths), "Incomplete production executable/object profile witnesses")
    child_inputs = [scratch + "/presentation-profiles/" + name + ".profraw"
                    for name in ("cancelled", "failure-ok", "panel-quit-grace", "progress-menu-quit")]
    fixture = evidence["presentationFixture"]
    child_indexed = scratch + "/presentation-fixture-profile.profdata"
    require(fixture["object"] == objects[-1] and path_witnesses(fixture["profiles"], child_inputs)
            and path_witnesses([fixture["indexed"]], [child_indexed]), "Mac presentation profile witnesses differ")
    outcomes = evidence["outcomes"]
    by_label = {r["label"]: r["exit"] for r in outcomes}
    required = {"launcher-usage": 64, "launcher-uninstalled-headless": 10, "installer-first": 0,
                "installer-replace": 0, "installer-foreign-target-refusal": 1}
    require(len(by_label) == len(outcomes) and all(re.fullmatch(r"[a-z][a-z0-9-]+", n) for n in by_label)
            and all(by_label.get(n) == c and read(n + ".json")["status"] == c for n, c in required.items()),
            "Missing profiled executable outcomes")
    combined = scratch + "/swift-coverage-profile.profdata"
    zero = scratch + "/swift-zero-profile.profdata"
    combined_inputs = [debug + "/codecov/default.profdata", *child_inputs,
                       *(scratch + "/" + n + ".profraw" for n in by_label)]
    require(path_witnesses(evidence["profiles"], combined_inputs)
            and evidence["profiles"][1:1 + len(child_inputs)] == fixture["profiles"],
            "Combined Swift profile input witnesses differ")
    for label, path, inputs in (
        ("left-sentinel-profile", scratch + "/left-sentinel-profile.profdata", [scratch + "/sentinel/Left.profraw"]),
        ("swift-zero-profile", zero, [scratch + "/sentinel/Left.profraw"]),
        ("swift-coverage-profile", combined, combined_inputs),
        ("presentation-fixture-profile", child_indexed, child_inputs),
    ):
        swift_command(z, prefix, label, scratch, ["llvm-profdata", "merge", "-sparse", "-o", path, *inputs], clean_stderr=True)
    for label, path, inputs in (
        ("swift-zero-baseline", zero, object_paths),
        ("swift-coverage", combined, object_paths),
        ("presentation-fixture-coverage", child_indexed, [child]),
    ):
        additional = [arg for obj in inputs[1:] for arg in ("-object", obj)]
        swift_command(z, prefix, label, scratch, ["llvm-cov", "export", "-instr-profile=" + path, inputs[0], *additional],
                      clean_stderr=True)
    observed = llvm_rows(read("presentation-fixture-coverage.stdout"), package)
    entry = observed["Presentation/LauncherPresentationEntry.swift"]
    require(fixture["productionEntry"] == {m: {"count": count, "covered": covered} for m, (count, covered) in entry.items()}
            and all(entry[m][1] > 0 for m in ("lines", "regions"))
            and z.read(prefix + "swift-coverage.profdata").startswith(bytes.fromhex("ff6c70726f666981")),
            "Missing profiled entry coverage or combined Swift profile")


def swift_case(test_id, row):
    case_id, name = row["id"], row["displayName"]
    require(all(isinstance(value, str) and value for value in (case_id, name)),
            "Invalid Swift case declaration or event")
    # Swift Testing may reuse opaque case IDs when an argument has no encodable identifier.
    return test_id, case_id, name


def swift_event_roster(events, passed_count):
    declarations = {}
    starts, ends = {}, {}
    declared_cases, started_cases, ended_cases = Counter(), Counter(), Counter()
    open_cases = Counter()
    running = False
    for i, record in enumerate(events):
        event = record["payload"]
        kind = event["kind"]
        require(type(record["version"]) is int and record["version"] == 0, "Unexpected Swift event format")
        if record["kind"] == "test":
            test_id = event["id"]
            require(not running and test_id and test_id not in declarations and kind in {"suite", "function"},
                    "Invalid or duplicate Swift test declaration")
            declarations[test_id] = kind
            cases = event.get("_testCases", [])
            if kind == "function":
                require(event["isParameterized"] is bool(cases), "Swift parameterized test roster differs")
            else:
                require(not cases, "Swift suite declares parameterized cases")
            declared_cases.update(swift_case(test_id, case) for case in cases)
            continue
        require(record["kind"] == "event", "Unexpected Swift event record")
        if kind == "runStarted":
            require(not running and declarations, "Swift test declarations or run start missing")
            running = True
            continue
        require(running, "Swift event precedes run start")
        if kind == "runEnded":
            require(i == len(events) - 1, "Swift event follows run end")
            continue
        require(kind in {"testStarted", "testEnded", "testCaseStarted", "testCaseEnded"},
                "Unexpected Swift test event, issue or skip")
        test_id = event["testID"]
        require(test_id in declarations and test_id not in ends, "Swift test event is unrelated or follows test end")
        if kind == "testStarted":
            require(test_id not in starts, "Duplicate Swift test start")
            starts[test_id] = i
        else:
            require(test_id in starts, "Swift test event has no matching start")
            if kind == "testEnded":
                require(not open_cases[test_id] and [m["symbol"] for m in event["messages"]] == ["pass"],
                        "Swift test did not pass or still has open cases")
                ends[test_id] = i
            elif kind == "testCaseStarted":
                case = swift_case(test_id, event["_testCase"])
                require(started_cases[case] < declared_cases[case], "Swift case start exceeds its declaration")
                started_cases[case] += 1
                open_cases[test_id] += 1
            else:
                case = swift_case(test_id, event["_testCase"])
                require(ended_cases[case] < started_cases[case], "Swift case end has no matching start")
                ended_cases[case] += 1
                open_cases[test_id] -= 1
    functions = {test_id for test_id, kind in declarations.items() if kind == "function"}
    require(starts.keys() == ends.keys() == declarations.keys() and len(functions) == passed_count
            and declared_cases == started_cases == ended_cases, "Swift test declaration, case or completion roster is incomplete")
    for test_id in functions:
        suite_id = test_id.rsplit("/", 2)[0]
        require(declarations.get(suite_id) == "suite" and starts[suite_id] < starts[test_id] < ends[test_id] < ends[suite_id],
                "Swift function is outside its declared suite lifetime")
    return {re.sub(r":\d+:\d+$", "", test_id) for test_id in functions}


def swift_tests(z, prefix, read, package):
    scratch = read("swift-tests.json")["cwd"]
    repo = package.removesuffix("/" + SWIFT.rstrip("/"))
    require(PurePosixPath(scratch).is_absolute() and PurePosixPath(scratch).name.startswith("graphgoblin-coverage-"),
            "Unbound Swift test scratch directory")
    swift_command(z, prefix, "swift-tests", scratch, [
        "swift", "test", "--package-path", package, "--arch", "arm64", "--scratch-path", scratch + "/swift-test",
        "--enable-code-coverage", "-Xswiftc", "-disable-batch-mode", "--verbose", "--event-stream-output-path",
        repo + "/.tmp/" + prefix + "swift-testing-events.jsonl", "--event-stream-version", "0",
    ], timeout=270_000)
    events = [json.loads(line) for line in z.read(prefix + "swift-testing-events.jsonl").splitlines()]
    require(events and events[-1]["kind"] == "event" and events[-1]["payload"]["kind"] == "runEnded",
            "Swift event stream has no terminal run end")
    messages = events[-1]["payload"]["messages"]
    match = re.fullmatch(r"Test run with ([1-9]\d*) tests passed after .+",
                         messages[0]["text"] if len(messages) == 1 and messages[0]["symbol"] == "pass" else "")
    stdout = z.read(prefix + "swift-tests.stdout").decode("utf-8")
    require(match and match[0] in stdout, "Swift final pass summary differs")
    passed = int(match[1])
    observed = swift_event_roster(events, passed)
    require(BRANCH_TESTS <= observed, "Explicit Swift branch-outcome tests missing")
    return passed


def mac_install(z, prefix, merge, tree, driver):
    m = json.loads(z.read(prefix + "manifest.json"))
    b = m["binding"]
    require((m["git"], b["commit"], b["tree"], b["driver"], b["authority"], b["platform"], b["arch"])
            == (merge, merge, tree, digest(driver), "local Git checkout", "darwin", "arm64")
            and m["stage"] == "fixture-cleanup" and m["outcome"] == "passed"
            and m["cleanup"].startswith("verified disposable bundle, receipt, logs and store removed;"),
            "Mac installer/gateway receipt differs from tested Git or cleanup failed")
    checkout = z.read(prefix + "004-checked-out-head.stdout").decode("utf-8").splitlines()
    require(len(checkout) == 3 and checkout[1:] == [merge, tree], "Mac installer checked out another object")
    rows = m["processes"]
    by_role = {}
    for p in rows:
        name = p["name"]
        require(re.fullmatch(r"\d{3}-[a-z0-9-]+", name) and p["spawnError"] is None
                and p["timedOut"] is False and p["truncated"] is False
                and p["eof"] == {"stdout": True, "stderr": True}, "Incomplete Mac installer process")
        for stream in ("stdout", "stderr"):
            require(len(z.read(f"{prefix}{name}.{stream}")) == p["received"][stream], "Mac installer stream length differs")
        by_role.setdefault(name[4:], []).append(p["exit"])
    require(m["nextProcess"] == len(rows) and len({p["name"] for p in rows}) == len(rows)
            and all(by_role.get(role) == [{"code": code, "signal": None}] for role, code in MAC_PROCESSES.items())
            and m["drain"][-3]["stage"] == "listener-and-leases-released"
            and m["drain"][-2]["stage"] == "original-process-gone" and m["drain"][-1]["stage"] == "store-state-free",
            "Mac installer, gateway, contention, replacement, or drain evidence is incomplete")
    health = [json.loads(line) for line in z.read(prefix + "final-gateway.log").splitlines()]
    owner_pid = m["owner"]["pid"]
    shells = m["shells"]
    require(uid(owner_pid) and any((r.get("pid"), r.get("res", {}).get("route"), r.get("res", {}).get("statusCode"))
                                       == (owner_pid, "/healthz", 200) for r in health)
            and {row["url"] for row in shells} == {"/app/", "/goblin/"} and len(shells) == 2
            and all(re.fullmatch(r"[0-9a-f]{64}", row[k]) for row in shells for k in ("shell", "assetHash"))
            and all(re.fullmatch(r"[0-9a-f]{64}", b[k]) for k in ("main", "helper"))
            and any(r["stage"] == "post-response" and r["status"] == 202 for r in m["drain"])
            and z.read(prefix + "final-launcher.log")
            and len(m["cases"]) >= 9 and "A second built API entry contended on the actual physical log reservation before touching its store."
            in m["cases"], "Missing hosted gateway observations")
    return {"manifestSha256": digest(z.read(prefix + "manifest.json")), "cases": m["cases"], "drain": m["drain"]}


def mac_native(raw, merge, tree, git_sources, driver):
    with ZipFile(BytesIO(raw)) as z:
        zip_members(z, 128 * 1024**2)
        versions = z.read("macos-launcher-toolchain/versions.txt").decode("utf-8").splitlines()
        require(versions[:2] == [merge, tree] and "arm64" in versions
                and any(re.fullmatch(r"Target: arm64-apple-macosx\S+", line) for line in versions), "Mac toolchain object binding differs")
        p = "macos-launcher-coverage/"
        read, package, production = swift_inventory(z, p, git_sources)
        count = swift_tests(z, p, read, package)
        swift_profiles(z, p, read, package)
        totals = swift_coverage(read, package, production)
        installer = mac_install(z, "macos-launcher-acceptance/", merge, tree, driver)
        return {"hostedOnly": True, "deviceLocalGuiAccepted": False, "testsPassed": count,
                "explicitBranchOutcomeTests": sorted(BRANCH_TESTS), "totals": totals,
                "productionSources": {path: {"target": target, "sha256": sha} for path, (target, sha) in production.items()},
                "installerGateway": installer}


def windows_native(root, raw, artifact, binding, node, replay, module, workspace):
    root.mkdir()
    store(root, "archive.zip", raw)
    corpus = root / "corpus"
    corpus.mkdir()
    hashes = {}
    with ZipFile(BytesIO(raw)) as z:
        require(zip_members(z, sum(NATIVE_MEMBERS.values())) == NATIVE_MEMBERS.keys(), "Unexpected Windows archive membership")
        for name, limit in NATIVE_MEMBERS.items():
            require(z.getinfo(name).file_size <= limit, "Windows archive member exceeds bound")
            data = z.read(name)
            hashes[name] = digest(data)
            store(corpus, name, data)
    m = json.loads((corpus / "manifest.json").read_bytes())["binding"]
    r = json.loads((corpus / "result.json").read_bytes())
    run_id, head, target, merge, tree = binding
    require((m["runId"], m["runAttempt"], m["eventHead"], m["eventBase"]) == (str(run_id), "1", head, target)
            and (m["checkout"]["head"], m["checkout"]["tree"], m["checkout"]["parents"]) == (merge, tree, [target, head])
            and r["steps"] == dict.fromkeys(("install", "build", "native"), "success")
            and r["status"] == "complete" and r["observations"]["state"] == "valid"
            and r["observations"]["rejected"] == 0 and uid(r["observations"]["records"]),
            "Windows typed carrier does not bind a complete current native job")
    store(root, "replay-archives.mjs", replay)
    store(root, "windows-launcher-evidence.mjs", module)
    record(root, "binding.json", [{"case": "positive", "artifactId": artifact, "runId": run_id, "freshCorpus": str(corpus)}])
    output = subprocess.check_output([str(node), str(root / "replay-archives.mjs"), str(root / "windows-launcher-evidence.mjs"),
                                      str(workspace), str(root / "replay"), str(root / "binding.json")], timeout=60)
    store(root, "replay.stdout.json", output)
    parsed = json.loads(output)
    cases = parsed["cases"]
    version = re.fullmatch(r"v22\.(\d+)\.(\d+)", parsed["node"])
    require(version and (int(version[1]), int(version[2])) >= (22, 2)
            and parsed["sha256"] == digest(module) and len(cases) == 1
            and (cases[0]["case"], cases[0]["artifactId"], cases[0]["runId"], cases[0]["records"])
            == ("positive", artifact, run_id, r["observations"]["records"])
            and cases[0]["exactResultReplay"] is True, "Canonical Windows replay differs")
    result = {"artifact": artifact, "digest": digest(raw), "bytes": len(raw), "files": hashes, "run": run_id,
              "head": head, "base": target, "merge": merge, "sourceTree": tree,
              "records": r["observations"]["records"], "canonicalReplay": True}
    record(root, "verified.json", result)
    return result


def main():
    p = ArgumentParser(description=__doc__)
    p.add_argument("pr", type=int)
    p.add_argument("run", type=int)
    p.add_argument("head")
    p.add_argument("target")
    p.add_argument("output", type=Path)
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--node", type=Path, required=True)
    p.add_argument("--windows-replay", type=Path, required=True)
    args = p.parse_args()
    root = args.output.resolve()
    workspace = args.workspace.resolve(strict=True)
    require(uid(args.pr) and uid(args.run) and hex40(args.head) and hex40(args.target) and args.head != args.target
            and workspace.is_dir() and not root.is_relative_to(workspace) and args.node.is_absolute()
            and args.node.is_file(), "Invalid PR/source/output or explicit Node selection")
    replay = args.windows_replay.read_bytes()
    require(digest(replay) == REPLAY_SHA, "Canonical Windows replay driver differs from reviewed driver")
    root.mkdir()
    run_path, pr_path, ref_path = f"actions/runs/{args.run}", f"pulls/{args.pr}", "git/ref/heads/main"
    run = retain(root, run_path, "run.json")
    pr = retain(root, pr_path, "pr.json")
    ref = retain(root, ref_path, "main.json")
    merge, repo_id = check_run(run, pr, ref, args.pr, args.run, args.head, args.target)
    c = retain(root, f"git/commits/{merge}", "merge.json")
    h = retain(root, f"git/commits/{args.head}", "head.json")
    require(c["sha"] == merge and h["sha"] == args.head and [r["sha"] for r in c["parents"]] == [args.target, args.head]
            and hex40(c["tree"]["sha"]) and hex40(h["tree"]["sha"]), "Tested merge does not have exact ordered parents")
    tree_sha = c["tree"]["sha"]
    jobs = check_jobs(retain(root, run_path + "/attempts/1/jobs?per_page=100", "jobs.json"), args.run, args.head)
    record(root, "first-outcomes.json", jobs)
    def load_log(pair):
        name, result = pair
        raw = get(f"actions/jobs/{result['job']}/logs")
        store(root, name.lower().replace(" ", "-") + ".log", raw)
        return name, log_text(raw)
    with ThreadPoolExecutor(max_workers=4) as workers:
        logs = dict(workers.map(load_log, jobs.items()))
    scores = check_logs(logs, merge)
    art = artifacts(retain(root, run_path + "/artifacts?per_page=100", "artifacts.json"), args.run, args.head, repo_id)
    v8_raw = archive(root, art["coverage"], logs["Coverage"], "coverage.zip")
    members = coverage_v8(v8_raw)
    mac_raw = archive(root, art["macos-launcher"], logs["macOS launcher"], "macos-launcher.zip")
    windows_raw = archive(root, art["windows-launcher-1"], logs["Windows launcher"], "windows-launcher.zip")
    tree = retain(root, f"git/trees/{tree_sha}?recursive=1", "tested-tree.json")
    require(tree["sha"] == tree_sha, "Wrong recursive tested Git tree")
    swift = {r["path"] for r in tree["tree"] if r["path"].startswith(SWIFT) and r["path"].endswith(".swift")}
    fetch_paths = {p for p in swift if production_path(p.removeprefix(SWIFT))}
    fetch_paths.update({SWIFT + "Package.swift", SWIFT + "Tests/PresentationFixture/PresentationFixture.swift",
                        WORKFLOW, WINDOWS, MAC_DRIVER})
    source = blobs(tree, fetch_paths)
    require(digest(source[WORKFLOW]) == WORKFLOW_SHA, "Tested workflow differs from the reviewed seven-job workflow")
    # The tracked roster is from the tested tree. Test-only files are not in the production denominator.
    swift_paths = {p.removeprefix(SWIFT): source.get(p) for p in swift}
    mac = mac_native(mac_raw, merge, tree_sha, swift_paths, source[MAC_DRIVER])
    mac["artifact"] = art["macos-launcher"]["id"]
    mac["archiveSha256"] = digest(mac_raw)
    control = windows_native(root / "windows", windows_raw, art["windows-launcher-1"]["id"],
                             (args.run, args.head, args.target, merge, tree_sha), args.node, replay, source[WINDOWS], workspace)
    current_run = retain(root, run_path, "run-final.json")
    final_pr = retain(root, pr_path, "pr-final.json")
    final_ref = retain(root, ref_path, "main-final.json")
    require(check_run(current_run, final_pr, final_ref, args.pr, args.run, args.head, args.target) == (merge, repo_id),
            "CI attempt, merge, or target changed during verification")
    receipt = {"pr": str(args.pr), "run": args.run, "attempt": 1, "head": args.head, "target": args.target,
               "testedMerge": merge, "headTree": h["tree"]["sha"], "testedTree": tree_sha, "jobs": jobs,
               **scores, "coverage": {"artifact": art["coverage"]["id"], "sha256": digest(v8_raw), "members": members},
               "otherArtifactIds": [control["artifact"], mac["artifact"]], "macOS": mac, "formalReview": False,
               "testedWorkflowSha256": digest(source[WORKFLOW])}
    record(root, "files.json", {f.relative_to(root).as_posix(): digest(f.read_bytes())
                                for f in sorted(root.rglob("*")) if f.is_file()})
    record(root, "verified.json", receipt)
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()

