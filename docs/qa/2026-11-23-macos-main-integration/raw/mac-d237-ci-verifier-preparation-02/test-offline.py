"""Offline boundary checks. Does not call a provider, Git, gh, Node, or the CLI entry point."""
from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path
from runpy import run_path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile

BASE = Path(__file__).resolve().parent
V = run_path(str(BASE / "verify-mac-ci.py"))
OLD_CI = BASE.parent / "i5-557-head2ac09-target3a694-ci-01"
OLD_MAC = Path("C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch/launcher/macos-pr501-ci-14/artifacts")
WORKSPACE = Path("G:/ggq/gg-macos-current-main/GraphGoblin")
HEAD, TARGET, MERGE, RUN = "a" * 40, "b" * 40, "c" * 40, 123
OLD_MERGE = "dd7e69023b2de8e796c0c4bc04157e4f898f66f8"
OLD_TREE = "689d42d357f4c817cc904ced31cd0d3700b65146"


def rewrite_zip(data, change):
    with ZipFile(BytesIO(data)) as z:
        items = {name: z.read(name) for name in z.namelist()}
    change(items)
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as z:
        for name, raw in items.items():
            z.writestr(name, raw)
    return output.getvalue()


class Offline(unittest.TestCase):
    def test_current_run_binding(self):
        repo = {"id": 1, "full_name": V["REPO"]}
        attached = {"number": 501, "head": {"repo": repo, "sha": HEAD},
                    "base": {"repo": repo, "sha": TARGET, "ref": "main"}}
        pr = {**attached, "state": "open", "merged": False, "merge_commit_sha": MERGE}
        ref = {"ref": "refs/heads/main", "object": {"sha": TARGET}}
        run = {"id": RUN, "head_sha": HEAD, "event": "pull_request", "status": "completed",
               "conclusion": "success", "run_attempt": 1, "path": V["WORKFLOW"], "repository": repo,
               "pull_requests": [attached]}
        check = V["check_run"]
        self.assertEqual(check(run, pr, ref, 501, RUN, HEAD, TARGET), (MERGE, 1))
        for key, value in [("run_attempt", 2), ("event", "workflow_dispatch"), ("conclusion", "failure"),
                           ("pull_requests", [{**attached, "number": 557}])]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                check({**run, key: value}, pr, ref, 501, RUN, HEAD, TARGET)
        for other in ({**pr, "merged": True}, {**pr, "base": {**pr["base"], "sha": HEAD}}):
            with self.assertRaisesRegex(ValueError, "Current open PR"):
                check(run, other, ref, 501, RUN, HEAD, TARGET)
        with self.assertRaisesRegex(ValueError, "Current open PR"):
            check(run, pr, {**ref, "object": {"sha": HEAD}}, 501, RUN, HEAD, TARGET)

    def test_exact_jobs_and_required_mac_step(self):
        jobs = []
        for job, (name, required) in enumerate(V["JOBS"].items(), 1):
            steps = required if name == "Gates" else required + ("Run actions/checkout@v4",)
            jobs.append({"id": job, "name": name, "run_id": RUN, "run_attempt": 1, "head_sha": HEAD,
                         "status": "completed", "conclusion": "success",
                         "steps": [{"name": s, "status": "completed", "conclusion": "success"} for s in steps]})
        self.assertEqual(len(V["check_jobs"]({"total_count": 7, "jobs": jobs}, RUN, HEAD)), 7)
        for partial in (jobs[:4], jobs[1:], jobs + [jobs[0]], jobs[:-1] + [jobs[0]]):
            with self.assertRaisesRegex(ValueError, "exactly seven"):
                V["check_jobs"]({"total_count": len(partial), "jobs": partial}, RUN, HEAD)
        failed = deepcopy(jobs)
        failed[0]["steps"][-2]["conclusion"] = "skipped"
        with self.assertRaisesRegex(ValueError, "Required step"):
            V["check_jobs"]({"total_count": 7, "jobs": failed}, RUN, HEAD)

    def test_actual_archived_log_formats_only(self):
        logs = {name: V["log_text"]((OLD_CI / (name.lower().replace(" ", "-") + ".log")).read_bytes())
                for name in V["JOBS"] if name != "macOS launcher"}
        merge = json.loads((OLD_CI / "verified.json").read_bytes())["testedMerge"]
        checked = V["check_logs"](logs, merge)
        self.assertEqual(checked["browserSkipped"], ["apps/web/e2e/live.spec.ts"])
        for job, text, replacement in (
            ("Browser", "test --retries=0", "test --retries=1"),
            ("Browser", "e2e/live.spec.ts:", "e2e/other.spec.ts:"),
            ("Browser", "1 skipped", "2 skipped"),
            ("Repository checks", "7 low | 13 moderate", "7 low | 1 high"),
            ("Windows launcher", "\n" + merge + "\n", "\n" + HEAD + "\n"),
            ("Gates", "Coverage: success", "Coverage: skipped"),
        ):
            self.assertIn(text, logs[job])
            with self.subTest(job=job, text=text), self.assertRaises(ValueError):
                V["check_logs"]({**logs, job: logs[job].replace(text, replacement)}, merge)

    def test_exact_v8_members_and_threshold(self):
        raw = (OLD_CI / "coverage.zip").read_bytes()
        self.assertEqual(len(V["coverage_v8"](raw)), 13)
        name = sorted(V["V8"])[0]
        def wrong_workspace(items):
            items["unadmitted/coverage-summary.json"] = items.pop(name)
        with self.assertRaisesRegex(ValueError, "13 workspace"):
            V["coverage_v8"](rewrite_zip(raw, wrong_workspace))
        def below(items):
            low = json.loads(items[name])
            low["total"]["branches"]["pct"] = 89.9
            items[name] = json.dumps(low).encode()
        with self.assertRaisesRegex(ValueError, "threshold"):
            V["coverage_v8"](rewrite_zip(raw, below))

    def test_artifact_metadata_binding(self):
        rows = [{"name": name, "id": n, "size_in_bytes": 1, "expired": False,
                 "workflow_run": {"id": RUN, "head_sha": HEAD, "repository_id": 1, "head_repository_id": 1}}
                for n, name in enumerate(("coverage", "windows-launcher-1", "macos-launcher"), 1)]
        self.assertEqual(set(V["artifacts"]({"total_count": 3, "artifacts": rows}, RUN, HEAD, 1)),
                         {"coverage", "windows-launcher-1", "macos-launcher"})
        for key, value in (("expired", True), ("workflow_run", {**rows[2]["workflow_run"], "head_sha": TARGET})):
            bad = [*rows[:2], {**rows[2], key: value}]
            with self.assertRaisesRegex(ValueError, "Unbound or expired"):
                V["artifacts"]({"total_count": 3, "artifacts": bad}, RUN, HEAD, 1)

    def test_windows_wrapper_uses_exact_replay_and_receipt(self):
        archive = OLD_CI.with_name(OLD_CI.name + "-windows")
        old = json.loads((archive / "verified.json").read_bytes())
        raw = (archive / "archive.zip").read_bytes()
        module = (WORKSPACE / V["WINDOWS"]).read_bytes()
        binding = tuple(old[k] for k in ("run", "head", "base", "merge", "sourceTree"))
        report = {"node": "v22.23.4", "sha256": V["digest"](module),
                  "cases": [{"case": "positive", "artifactId": old["artifact"], "runId": old["run"],
                             "records": old["records"], "exactResultReplay": True}]}
        args = (raw, old["artifact"], binding, Path("fake-node"), b"fake-replay-for-test", module, WORKSPACE)
        with TemporaryDirectory(dir=BASE) as scratch:
            folder = Path(scratch)
            with patch.object(V["subprocess"], "check_output", return_value=json.dumps(report).encode()) as replay:
                windows = V["windows_native"](folder / "good", *args)
                self.assertEqual(windows, old)
                invoked = replay.call_args.args[0]
                self.assertEqual(invoked[0], "fake-node")
                self.assertEqual(Path(invoked[2]).read_bytes(), module)
                self.assertEqual(replay.call_args.kwargs["timeout"], 60)
            with patch.object(V["subprocess"], "check_output") as replay:
                wrong = (raw, old["artifact"], (*binding[:2], TARGET, *binding[3:]), *args[3:])
                with self.assertRaisesRegex(ValueError, "Windows typed carrier"):
                    V["windows_native"](folder / "wrong-source", *wrong)
                replay.assert_not_called()
            report["cases"][0]["exactResultReplay"] = False
            with patch.object(V["subprocess"], "check_output", return_value=json.dumps(report).encode()):
                with self.assertRaisesRegex(ValueError, "Canonical Windows replay differs"):
                    V["windows_native"](folder / "wrong-replay", *args)
            self.assertFalse((folder / "wrong-replay" / "verified.json").exists())

    def test_export_and_profile_receipts(self):
        raw = (OLD_MAC / "macos-launcher-14362060639.zip").read_bytes()
        swift = WORKSPACE / "apps/macos-launcher"
        sources = {p.relative_to(swift).as_posix(): p.read_bytes() for p in swift.rglob("*.swift")}
        args = OLD_MERGE, OLD_TREE, sources, (WORKSPACE / V["MAC_DRIVER"]).read_bytes()
        original = run_path(str(BASE.parent / "mac-d237-ci-verifier-preparation-01" / "verify-mac-ci.py"))
        prefix = "macos-launcher-coverage/"

        def failed(items):
            path = prefix + "swift-coverage.json"
            receipt = json.loads(items[path])
            receipt.update(status=1, signal="SIGTERM", error="synthetic failure",
                           args=["--sdk", "macosx", "llvm-cov", "export", "-instr-profile=/stale/wrong.profdata"])
            items[path] = json.dumps(receipt).encode("utf-8")

        def absent(items):
            del items[prefix + "swift-coverage.json"]
            del items[prefix + "swift-zero-baseline.json"]

        for change, message in ((failed, "Failed or misbound Swift command"), (absent, "Missing Swift command receipt")):
            changed = rewrite_zip(raw, change)
            self.assertTrue(original["mac_native"](changed, *args)["testsPassed"] > 0)
            with self.subTest(mutation=change.__name__), self.assertRaisesRegex(ValueError, message):
                V["mac_native"](changed, *args)

        def mutate_receipt(items, label, change):
            path = prefix + label + ".json"
            receipt = json.loads(items[path])
            change(receipt)
            items[path] = json.dumps(receipt).encode("utf-8")

        mutations = (
            ("swift-coverage", lambda r: r["args"].pop(), "misbound"),
            ("swift-zero-baseline", lambda r: r["args"].__setitem__(4, "-instr-profile=/stale/wrong.profdata"), "misbound"),
            ("swift-coverage-profile", lambda r: r["args"].reverse(), "misbound"),
            ("swift-zero-profile", lambda r: r["args"].__setitem__(-1, "/stale/wrong.profraw"), "misbound"),
            ("presentation-fixture-profile", lambda r: r.update(status=False), "misbound"),
            ("presentation-fixture-coverage", lambda r: r["stdout"].update(sha256="0" * 64), "stream differs"),
            ("swift-zero-baseline", lambda r: r["stderr"].update(size=1), "stream differs"),
        )
        for label, change, message in mutations:
            broken = rewrite_zip(raw, lambda items: mutate_receipt(items, label, change))
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, message):
                V["mac_native"](broken, *args)

    def test_complete_swift_event_roster(self):
        raw = (OLD_MAC / "macos-launcher-14362060639.zip").read_bytes()
        swift = WORKSPACE / "apps/macos-launcher"
        sources = {p.relative_to(swift).as_posix(): p.read_bytes() for p in swift.rglob("*.swift")}
        args = OLD_MERGE, OLD_TREE, sources, (WORKSPACE / V["MAC_DRIVER"]).read_bytes()
        original = run_path(str(BASE.parent / "mac-d237-ci-verifier-preparation-01" / "verify-mac-ci.py"))
        path = "macos-launcher-coverage/swift-testing-events.jsonl"

        def edit_events(items, edit):
            events = [json.loads(line) for line in items[path].splitlines()]
            items[path] = b"".join((json.dumps(row) + "\n").encode("utf-8") for row in edit(events))

        def partial(events):
            keep = [r for r in events if r["payload"]["kind"] in {"runStarted", "runEnded"}
                    or (r["payload"]["kind"] == "testEnded"
                        and V["re"].sub(r":\d+:\d+$", "", r["payload"]["testID"]) in V["BRANCH_TESTS"])]
            self.assertEqual(len(keep), 8)
            return keep

        truncated = rewrite_zip(raw, lambda items: edit_events(items, partial))
        self.assertEqual(original["mac_native"](truncated, *args)["testsPassed"],
                         V["mac_native"](raw, *args)["testsPassed"])
        with self.assertRaisesRegex(ValueError, "test declarations or run start missing"):
            V["mac_native"](truncated, *args)

        def dropped_case(events):
            start = next(r["payload"] for r in events if r["payload"]["kind"] == "testCaseStarted")
            selected = [r for r in events if r["payload"].get("testID") == start["testID"]
                        and r["payload"].get("_testCase") == start["_testCase"]]
            self.assertEqual(len(selected), 2)
            return [r for r in events if r not in selected]

        def case_out_of_order(events):
            start = next(i for i, r in enumerate(events) if r["payload"]["kind"] == "testCaseStarted")
            witness = events[start]["payload"]
            end = next(i for i, r in enumerate(events) if r["payload"]["kind"] == "testCaseEnded"
                       and r["payload"]["testID"] == witness["testID"] and r["payload"]["_testCase"] == witness["_testCase"])
            events[start], events[end] = events[end], events[start]
            return events

        def missing_suite(events):
            suite = next(r["payload"]["id"] for r in events if r["payload"]["kind"] == "suite")
            return [r for r in events if r["payload"].get("id") != suite and r["payload"].get("testID") != suite]

        def changed_branch(events):
            branch = sorted(V["BRANCH_TESTS"])[0]
            for row in events:
                for key in ("id", "testID"):
                    payload = row["payload"]
                    if payload.get(key, "").startswith(branch + ":"):
                        payload[key] = payload[key].replace("()/", "Renamed()/", 1)
            return events

        for edit, message in ((dropped_case, "completion roster"), (case_out_of_order, "case end has no matching start"),
                              (missing_suite, "suite lifetime"), (changed_branch, "branch-outcome tests missing")):
            amended = rewrite_zip(raw, lambda items: edit_events(items, edit))
            with self.subTest(change=edit.__name__), self.assertRaisesRegex(ValueError, message):
                V["mac_native"](amended, *args)

    def test_actual_archived_mac_format_and_refusals_only(self):
        raw = (OLD_MAC / "macos-launcher-14362060639.zip").read_bytes()
        swift = WORKSPACE / "apps/macos-launcher"
        sources = {p.relative_to(swift).as_posix(): p.read_bytes() for p in swift.rglob("*.swift")}
        driver = (WORKSPACE / V["MAC_DRIVER"]).read_bytes()
        checked = V["mac_native"](raw, OLD_MERGE, OLD_TREE, sources, driver)
        self.assertTrue(checked["hostedOnly"])
        self.assertFalse(checked["deviceLocalGuiAccepted"])
        self.assertEqual(len(checked["productionSources"]), 25)
        self.assertTrue(checked["testsPassed"] > 0)
        with self.assertRaisesRegex(ValueError, "toolchain object binding"):
            V["mac_native"](raw, HEAD, OLD_TREE, sources, driver)
        with self.assertRaisesRegex(ValueError, "source digests differ"):
            V["mac_native"](raw, OLD_MERGE, OLD_TREE, {**sources, "Entry.swift": b"changed"}, driver)
        with self.assertRaisesRegex(ValueError, "receipt differs"):
            V["mac_native"](raw, OLD_MERGE, OLD_TREE, sources, b"changed installer driver")
        events = "macos-launcher-coverage/swift-testing-events.jsonl"
        witness = next(iter(V["BRANCH_TESTS"])).encode()
        def remove_branch(items):
            lines = items[events].splitlines(keepends=True)
            selected = [line for line in lines if witness in line.replace(b"\\/", b"/") and b'"kind":"testEnded"' in line]
            self.assertEqual(len(selected), 1)
            items[events] = b"".join(line for line in lines if line not in selected)
        with self.assertRaisesRegex(ValueError, "completion roster"):
            V["mac_native"](rewrite_zip(raw, remove_branch), OLD_MERGE, OLD_TREE, sources, driver)
        def missing_installer_member(items):
            items.pop("macos-launcher-acceptance/005-public-install.stdout")
        with self.assertRaisesRegex(KeyError, "005-public-install"):
            V["mac_native"](rewrite_zip(raw, missing_installer_member), OLD_MERGE, OLD_TREE, sources, driver)


if __name__ == "__main__":
    unittest.main(verbosity=2)

