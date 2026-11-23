"""Run one separately admitted D242 B2 correction assessment on ordinary Max."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import time
from threading import Event, Lock, Thread

E = Path("G:/ggq/delivery-evidence/2026-11-17-five-intents")
HELPER = Path(__file__).resolve()
CLAUDE = Path("C:/Users/98jak/.local/bin/claude.exe")
GIT = Path("C:/Program Files/Git/cmd/git.exe")
NODE = Path("C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64")
DECISION = E / "i5-d242-b2-remount-correction-01/DECISION.md"
DECISION_SHA = "fde33cf9501704239af7e45de22b68785b09163f34e5438f97658f3a95b234ec"
NOT_BEFORE = 1795417200
OWNER_LOCK = E / "i5-d236-max-continuation-owner.lock"
SCOPE = "D242-ordinary-max-b2-correction-assessment"
REVIEW = "b2-correction-review"
MODEL = "claude-fable-5-2"
CORE = {
    "apps/web/src/api/queries.ts",
    "apps/web/src/runs/inspector-read-provenance.ts",
    "apps/web/src/runs/inspector-read-provenance.test.ts",
}
CORRECTION_PATHS = {
    "apps/web/src/runs/RunInspectorPage.tsx",
    "apps/web/src/runs/HistoryEligibility.tsx",
    "apps/web/src/runs/inspector/ScriptRecovery.tsx",
    "apps/web/src/runs/RunInspectorPage.offline.test.tsx",
    "apps/web/src/runs/HistoryEligibility.test.tsx",
    "apps/web/src/runs/ScriptRecovery.test.tsx",
    "docs/09-frontend-and-pwa.md",
    "CHANGELOG.md",
}
READ_LIMIT = {
    "docs/README.md",
    "AGENTS.md",
    "docs/15-issue-workflow.md",
    "docs/12-implementation-plan.md",
    "apps/web/src/runs/RunInspectorPage.tsx",
    "apps/web/src/runs/HistoryEligibility.tsx",
    "apps/web/src/runs/inspector/ScriptRecovery.tsx",
    "apps/web/src/runs/RunInspectorPage.offline.test.tsx",
    "apps/web/src/runs/HistoryEligibility.test.tsx",
    "apps/web/src/runs/ScriptRecovery.test.tsx",
    "docs/09-frontend-and-pwa.md",
    "CHANGELOG.md",
    "apps/web/src/api/queries.ts",
    "apps/web/src/runs/inspector-read-provenance.ts",
    "apps/web/src/runs/inspector-read-provenance.test.ts",
    "apps/web/src/runs/inspector/SessionRecoveryControls.tsx",
    "apps/web/src/runs/inspector/RunControls.tsx",
    "apps/web/src/runs/inspector/SessionRecoveryControls.test.tsx",
    "apps/web/src/runs/RunsPage.tsx",
    "apps/web/src/runs/RunInspectorPage.lifecycle.test.tsx",
    "apps/web/src/runs/RunInspectorPage.corrective.test.tsx",
    "apps/web/src/runs/RunInspectorPage.test.tsx",
    "apps/web/src/runs/recovery-controls.test.tsx",
    "apps/web/src/api/context.tsx",
    "apps/web/src/api/ApiKeyPanel.tsx",
    "apps/web/src/api/api-key.ts",
    "apps/web/src/__fixtures__/fake-api.ts",
    "apps/web/src/__fixtures__/render.tsx",
    "apps/web/src/__fixtures__/setup.ts",
    "apps/web/src/components/ui/dialog.tsx",
    "apps/web/src/components/ui/alert.tsx",
    "apps/web/src/lib/reachability.ts",
    "packages/contracts/src/run.ts",
    "packages/contracts/src/deletion.ts",
    "packages/api-client/src/resources.ts",
    "packages/api-client/src/errors.ts",
}
KEEP_ENV = ("SystemRoot", "WINDIR", "ComSpec", "PATH", "PATHEXT", "TEMP", "TMP",
            "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS")


class Refusal(ValueError):
    pass


def need(ok, code):
    if not ok:
        raise Refusal(code)


def read(path):
    return json.loads(path.read_bytes().decode("utf-8"))


def pin(path):
    raw = path.read_bytes()
    return {"source": str(path), "bytes": len(raw), "sha256": sha256(raw).hexdigest()}


def path_at(value):
    need(isinstance(value, str), "EXACT_PATH_UNSET")
    path = Path(value)
    need(path.is_absolute() and path.resolve() == path and ".." not in path.parts, "NONCANONICAL_PATH")
    return path


def bound(ref):
    need(isinstance(ref, dict) and set(ref) == {"source", "bytes", "sha256"}
         and type(ref["bytes"]) is int and ref["bytes"] > 0
         and isinstance(ref["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", ref["sha256"]), "EXACT_PIN_UNSET")
    path = path_at(ref["source"])
    need(path.is_file() and pin(path) == ref, "PINNED_BYTES_DIFFERS")
    return path


def evidence_path(value):
    path = path_at(value)
    need(path != E and path.is_relative_to(E)
         and not any("private" in part.casefold() for part in path.relative_to(E).parts), "PUBLIC_RECEIPT_REQUIRED")
    return path


def public_ref(ref):
    need(isinstance(ref, dict), "PUBLIC_RECEIPT_REQUIRED")
    evidence_path(ref["source"])
    return bound(ref)


def literal(name):
    need(isinstance(name, str) and not re.search(r'[\x00-\x1f\x7f\\:<>|?*"]', name), "UNSAFE_LITERAL_PATH")
    parts = name.split("/")
    bad = {".git", ".claude", "node_modules", ".npmrc"}
    need(all(part and part not in (".", "..") and not part.endswith((" ", "."))
             and not re.fullmatch(r"(?i)(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part)
             and part.casefold() not in bad
             and not part.casefold().startswith((".env", "private")) for part in parts)
         and PurePosixPath(name).as_posix() == name, "UNSAFE_LITERAL_PATH")
    return name


def scope_for(c):
    need(c["rootAdmitted"] is True and c["scope"] == SCOPE, "ROOT_ADMISSION_UNSET")
    need(c.get("apiRouteAuthorized") is False, "API_ROUTE_MUST_REMAIN_CLOSED")
    need(c["role"] == REVIEW and c["model"] == MODEL and c["effort"] == "xhigh", "ROLE_MODEL_UNSET")
    need(type(c["deadlineSeconds"]) is int and 0 < c["deadlineSeconds"] <= 1200, "DEADLINE_UNSET")
    reads, writes = c["allowedReadPaths"], c["allowedWritePaths"]
    need(isinstance(reads, list) and isinstance(writes, list), "LITERAL_PATHS_UNSET")
    reads = [literal(name) for name in reads]
    read_set = set(reads)
    need(len({name.casefold() for name in reads}) == len(reads)
         and CORE | CORRECTION_PATHS <= read_set <= READ_LIMIT, "READ_SCOPE_DIFFERS")
    need(writes == [], "WRITE_SCOPE_DIFFERS")
    return read_set, set()


def clean_env(source):
    base = {name.casefold(): value for name, value in source.items()}
    env = {name: base[name.casefold()] for name in KEEP_ENV if name.casefold() in base}
    need("USERPROFILE" in env and "SystemRoot" in env, "DEFAULT_PROFILE_ENV_UNAVAILABLE")
    env["PATH"] = str(NODE) + os.pathsep + env.get("PATH", "")
    return env


def max_auth(value):
    return (value.get("loggedIn") is True and value.get("authMethod") == "claude.ai"
            and value.get("apiProvider") == "firstParty" and value.get("subscriptionType") == "max"
            and value.get("apiKeySource") is None)


def argv(binary, role, model, reads, writes):
    need(role == REVIEW and model == MODEL and not writes, "READ_ONLY_FABLE_ROLE_REQUIRED")
    tools = "Read"
    role_prompt = ("Independently assess only the root-admitted D242 B2 script and deletion correction. "
                   "Give ACCEPT FIX or CHANGES REQUIRED only for this known correction.")
    prompt = (role_prompt + " Use only root-listed literal paths. No commands, browser, agents, network or credentials. "
              "Return ordinary text and actual evidence. Do not claim tests ran."
              f" Read paths: {json.dumps(sorted(reads))}. Write paths: {json.dumps(sorted(writes))}.")
    return [str(binary), "--print", "--model", model, "--effort", "xhigh",
            "--safe-mode", "--restricted", "--setting-sources", "", "--strict-mcp-config", "--mcp-config",
            '{"mcpServers":{}}', "--tools", tools, "--allowedTools", tools,
            "--disable-slash-commands", "--no-chrome", "--no-session-persistence", "--output-format", "stream-json",
            "--verbose", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--system-prompt", prompt]


def git_reader(binary, cwd, env):
    safe = {**env, "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_LAZY_FETCH": "1"}
    def git(*args):
        return subprocess.check_output(
            [str(binary), "--no-optional-locks", "-c", "maintenance.auto=false", "-c", "gc.auto=0", *args],
            cwd=cwd, env=safe, stderr=subprocess.PIPE, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
    return git


def local_file(cwd, name):
    file = cwd / literal(name)
    need(file.resolve() == file and file.is_relative_to(cwd), "SOURCE_PATH_REPARSE_OR_ESCAPE")
    return file


def source_state(cwd, git, core_files):
    def text(*args):
        return git(*args).decode("utf-8").strip()
    name = text("rev-parse", "--show-toplevel")
    need(Path(name).resolve() == cwd, "WRONG_CHECKOUT")
    merge = Path(text("rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"))
    need(not os.path.lexists(merge), "MERGE_IN_PROGRESS")
    index = Path(text("rev-parse", "--path-format=absolute", "--git-path", "index"))
    head = text("rev-parse", "HEAD")
    tree = text("rev-parse", "HEAD^{tree}")
    parents = text("show", "-s", "--format=%P", "HEAD").split()
    fixed = {name: pin(local_file(cwd, name)) for name in sorted(CORE)}
    need(fixed == core_files, "PROTECTED_D236_CORE_DIFFERS")
    return {"source": {"head": head, "tree": tree, "parents": parents},
            "index": pin(index), "lock": pin(local_file(cwd, "pnpm-lock.yaml")),
            "modules": pin(path_at(str(cwd / "node_modules/.modules.yaml"))), "core": fixed}


def visible_changes(git):
    tracked = git("diff", "--name-only", "--no-renames", "--no-ext-diff", "-z", "HEAD", "--")
    untracked = git("ls-files", "--others", "--exclude-standard", "-z")
    return {item.decode("utf-8") for raw in (tracked, untracked) for item in raw.split(b"\0") if item}


def tool_scope(item, cwd, reads, writes):
    name = item.get("name")
    allowed = {"Read", "Edit", "Write"} if writes else {"Read"}
    need(item["type"] == "tool_use" and name in allowed, "OUT_OF_SCOPE_TOOL")
    value = item.get("input", {}).get("file_path")
    need(isinstance(value, str), "TOOL_PATH_UNSET")
    file = Path(value)
    file = file if file.is_absolute() else cwd / file
    resolved = file.resolve()
    need(resolved == file and resolved.is_relative_to(cwd), "OUT_OF_SCOPE_TOOL_PATH")
    relative = resolved.relative_to(cwd).as_posix()
    paths = reads if name == "Read" else writes
    need(relative.casefold() in {p.casefold() for p in paths}, "OUT_OF_SCOPE_TOOL_PATH")
    return {"tool": name, "path": relative}


def terminal(stdout, model, cwd, reads, writes, code, complete_capture):
    result, result_count, result_seen = {}, 0, False
    models, seen, pending = set(), set(), set()
    tools, problems = [], []
    last, partial, matched = "", "", 0
    tainted = False
    for line in stdout.splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line.decode("utf-8"))
            need(isinstance(row, dict), "MALFORMED_STREAM_EVENT")
            kind = row["type"]
            if result_seen:
                result_count += int(kind == "result")
                need(False, "EVENT_AFTER_TERMINAL")
            if kind == "result":
                result_seen = True
                result_count += 1
                result = row
                continue
            if tainted:
                continue
            if kind == "assistant":
                message = row["message"]
                need(isinstance(message["model"], str), "MALFORMED_ASSISTANT_MODEL")
                models.add(message["model"])
                text, acted = "", False
                for item in message["content"]:
                    kind = item["type"]
                    if kind == "text":
                        need(isinstance(item["text"], str), "MALFORMED_ORDINARY_TEXT")
                        text = item["text"]
                    elif kind in {"tool_use", "server_tool_use"}:
                        tool = tool_scope(item, cwd, reads, writes)
                        identity = item.get("id")
                        need(isinstance(identity, str) and bool(identity) and identity not in seen,
                             "DUPLICATE_OR_MISSING_TOOL_ID")
                        seen.add(identity)
                        pending.add(identity)
                        tools.append(tool)
                        acted = True
                    elif kind == "tool_result":
                        need(False, "TOOL_RESULT_WRONG_ROLE")
                if text.strip():
                    partial = text.encode("utf-8", errors="replace")[:65536].decode("utf-8", errors="ignore")
                if acted or pending:
                    last = ""
                elif text.strip():
                    last = text
            elif kind == "user":
                for item in row.get("message", {}).get("content", []):
                    if item["type"] in {"tool_use", "server_tool_use"}:
                        need(False, "TOOL_REQUEST_WRONG_ROLE")
                    if item["type"] == "tool_result":
                        identity = item.get("tool_use_id")
                        need(isinstance(identity, str) and identity in pending, "UNMATCHED_TOOL_RESULT")
                        pending.remove(identity)
                        matched += 1
                        last = ""
            elif kind == "stream_event":
                need(False, "UNEXPECTED_PARTIAL_EVENT")
        except Refusal as error:
            problems.append(str(error))
            # Still record the terminal metadata, without trusting later ordinary text.
            tainted = True
        except (UnicodeError, ValueError, TypeError, KeyError, AttributeError):
            problems.append("MALFORMED_STREAM_EVENT")
            tainted = True
    if pending:
        problems.append("UNPAIRED_TOOL_REQUEST")
    usage = result.get("modelUsage")
    record = {"terminalCount": result_count, "observedModels": sorted(models), "toolRequests": tools,
              "matchedToolResults": matched, "pendingToolRequests": len(pending),
              "processExit": code, "streamComplete": complete_capture, "protocolProblems": sorted(set(problems)),
              "subtype": result.get("subtype"), "terminalReason": result.get("terminal_reason"),
              "isError": result.get("is_error"), "modelUsage": sorted(usage) if isinstance(usage, dict) else []}
    accepted = (complete_capture and not problems and result_count == 1 and code == 0
                and result.get("is_error") is False and result.get("subtype") == "success"
                and result.get("terminal_reason") == "completed" and models == {model}
                and isinstance(usage, dict) and set(usage) == {model}
                and bool(last.strip()) and last == partial and result.get("result") == last)
    return record, partial, accepted


class PipeCapture:
    def __init__(self, pipe, limit):
        self.pipe, self.limit = pipe, limit
        self.lock, self.done = Lock(), Event()
        self.data, self.total, self.error = bytearray(), 0, None

    def drain(self):
        try:
            for chunk in iter(lambda: self.pipe.read1(65536), b""):
                with self.lock:
                    self.total += len(chunk)
                    self.data.extend(chunk[:max(0, self.limit - len(self.data))])
        except (OSError, ValueError) as error:
            self.error = type(error).__name__
        finally:
            try:
                self.pipe.close()
            except OSError as error:
                self.error = type(error).__name__
            finally:
                self.done.set()

    def start(self):
        Thread(target=self.drain, daemon=True).start()

    def wait(self, deadline):
        return self.done.wait(max(0, deadline - time.monotonic()))

    def snapshot(self):
        with self.lock:
            return bytes(self.data), self.total


def owned_capture(child, deadline):
    stdout = PipeCapture(child.stdout, 16 * 1024 * 1024)
    stderr = PipeCapture(child.stderr, 0)
    failure = None
    cleanup_errors = []
    timed_out = False
    direct_stop = False
    try:
        stdout.start()
        stderr.start()
        child.wait(timeout=max(0.001, deadline - time.monotonic()))
        if not (stdout.wait(deadline) and stderr.wait(deadline)):
            raise subprocess.TimeoutExpired("owned CLI stream drain", 0)
    except BaseException as error:
        failure = error
        timed_out = isinstance(error, subprocess.TimeoutExpired)
    finally:
        if failure is not None:
            if child.poll() is None:
                try:
                    # Windows Popen.kill uses this process handle, not a numeric PID lookup.
                    child.kill()
                    direct_stop = True
                except OSError as error:
                    cleanup_errors.append(type(error).__name__)
                try:
                    child.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired) as error:
                    cleanup_errors.append(type(error).__name__)
            grace = time.monotonic() + 5
            stdout.wait(grace)
            stderr.wait(grace)
    data, total = stdout.snapshot()
    _, err_bytes = stderr.snapshot()
    truncated = total > len(data)
    eof = stdout.done.is_set() and stderr.done.is_set()
    errors = [x for x in (stdout.error, stderr.error) if x]
    if failure is None and (truncated or errors):
        failure = Refusal("BOUNDED_CAPTURE_TRUNCATED_OR_FAILED")
    record = {"directChildReaped": child.poll() is not None, "directHandleStopIssued": direct_stop,
              "streamReadersFinished": eof, "stdoutTruncated": truncated, "stdoutBytesObserved": total,
              "stderrBytesObserved": err_bytes, "readerErrors": errors, "cleanupErrors": cleanup_errors,
              "timeout": timed_out, "descendantClosureVerified": False}
    return data, record, failure


def failure_record(error):
    return {"class": type(error).__name__, "reason": str(error) if isinstance(error, Refusal) else None}


def source_after(cwd, git, protected, before, writes):
    record = {"snapshotAttempted": True, "visibleChangesAttempted": True, "baseline": before}
    after = None
    changes = None
    try:
        after = source_state(cwd, git, protected)
        record["snapshot"] = after
    except Exception as error:
        record["snapshotError"] = failure_record(error)
    try:
        changes = visible_changes(git)
        record["changedPaths"] = sorted(changes)
        need(changes <= writes and all(local_file(cwd, name).is_file() for name in changes), "LITERAL_WRITES_DIFFERS")
    except Exception as error:
        record["visibleChangesError"] = failure_record(error)
    record["sourceAndControlsVerified"] = after == before and changes is not None and "visibleChangesError" not in record
    return record


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(value, out, indent=2)
        out.write("\n")


def require_owner(receipt, c, now):
    stamp = datetime.fromisoformat(receipt["utc"].replace("Z", "+00:00"))
    need(receipt["scope"] == SCOPE and receipt["role"] == c["role"] and receipt["source"] == c["source"]
         and receipt["rootExclusiveOwner"] is True and receipt["noOtherOwnedWorker"] is True
         and 0 <= now - stamp.timestamp() <= 300, "FRESH_EXCLUSIVE_OWNER_REQUIRED")


def launch(config):
    need(time.time() >= NOT_BEFORE, "MAX_RESET_NOT_REACHED")
    need(sha256(DECISION.read_bytes()).hexdigest() == DECISION_SHA, "D242_DECISION_DIFFERS")
    c = read(evidence_path(config))
    reads, writes = scope_for(c)
    cwd, output = path_at(c["checkout"]), path_at(c["output"])
    need(cwd.is_dir() and cwd.is_relative_to(Path("G:/ggq")) and not cwd.is_relative_to(E),
         "CHECKOUT_OUTSIDE_AUTHORIZED_WORKSPACE")
    need(output.parent == E and not os.path.lexists(output), "FRESH_OUTPUT_REQUIRED")
    model, role = c["model"], c["role"]
    source = c["source"]
    need(isinstance(source, dict) and set(source) == {"head", "tree", "parents"}
         and isinstance(source["parents"], list) and bool(source["parents"])
         and all(isinstance(k, str) and re.fullmatch(r"[a-f0-9]{40}", k)
                 for k in [source["head"], source["tree"], *source["parents"]]), "EXACT_SOURCE_UNSET")
    cli_ref, git_ref = c["claudeBinary"], c["gitBinary"]
    need(isinstance(cli_ref, dict) and isinstance(git_ref, dict)
         and path_at(cli_ref["source"]) == CLAUDE and path_at(git_ref["source"]) == GIT, "EXACT_LOCAL_BINARY_REQUIRED")
    cli, git_binary = bound(cli_ref), bound(git_ref)
    acceptance = read(public_ref(c["independentAcceptance"]))
    need(acceptance["scope"] == SCOPE and acceptance["mechanicsAccepted"] is True
         and acceptance["actualRuntimeAdmission"] is False and acceptance["role"] == REVIEW
         and acceptance["readOnly"] is True and acceptance["authorRoleRejected"] is True
         and acceptance["controllerSha256"] == pin(HELPER)["sha256"], "INDEPENDENT_MECHANICS_REQUIRED")
    owner = read(public_ref(c["singleOwner"]))
    require_owner(owner, c, time.time())
    brief = public_ref(c["brief"]).read_bytes()
    need(bool(brief.strip()), "EMPTY_BRIEF")
    env = clean_env(os.environ)
    git = git_reader(git_binary, cwd, env)
    before = source_state(cwd, git, c["corePins"])
    need(before["source"] == source and not git("status", "--porcelain=v1", "-z", "--untracked-files=all"),
         "EXACT_CLEAN_SOURCE_REQUIRED")
    need(all(local_file(cwd, name).is_file() for name in reads), "BOUND_READ_INPUT_MISSING")
    newly_writable = {name for name in writes if not local_file(cwd, name).exists()}
    child = None
    output_owned = False
    release_lock = False
    OWNER_LOCK.mkdir(exist_ok=False)
    try:
        output.mkdir(exist_ok=False)
        output_owned = True
        need(time.time() >= NOT_BEFORE, "MAX_RESET_NOT_REACHED")
        auth = subprocess.run([str(cli), "auth", "status", "--json"], cwd=cwd, env=env,
                              capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW)
        need(auth.returncode == 0 and max_auth(json.loads(auth.stdout.decode("utf-8"))), "ORDINARY_MAX_REQUIRED")
        prompt = output / "public-brief.md"
        with prompt.open("xb") as out:
            out.write(brief)
        with prompt.open("rb") as stdin:
            need(source_state(cwd, git, c["corePins"]) == before
                 and not git("status", "--porcelain=v1", "-z", "--untracked-files=all"), "SOURCE_DRIFT_BEFORE_LAUNCH")
            require_owner(owner, c, time.time())
            need(time.time() >= NOT_BEFORE, "MAX_RESET_NOT_REACHED")
            started = datetime.now(timezone.utc).isoformat()
            deadline = time.monotonic() + c["deadlineSeconds"]
            child = subprocess.Popen(argv(cli, role, model, reads, writes), cwd=cwd, env=env, stdin=stdin,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
            stdout = b""
            process = {"directChildReaped": False, "streamReadersFinished": False, "descendantClosureVerified": False}
            failure = None
            harvest_errors = []
            try:
                stdout, process, failure = owned_capture(child, deadline)
            except BaseException as error:
                failure = error
                if child.poll() is None:
                    try:
                        child.kill()
                        child.wait(timeout=5)
                    except (OSError, subprocess.TimeoutExpired) as cleanup_error:
                        harvest_errors.append(failure_record(cleanup_error))
                process["directChildReaped"] = child.poll() is not None
            finally:
                process.update(pid=child.pid, startedUtc=started, finishedUtc=datetime.now(timezone.utc).isoformat(),
                               deadlineSeconds=c["deadlineSeconds"], role=role, model=model, effort="xhigh",
                               auth="claude.ai firstParty max",
                               originalFailure=failure_record(failure) if failure is not None else None)
                source_check = source_after(cwd, git, c["corePins"], before, writes)
                source_check["closureUncertainAtReadback"] = not (process["directChildReaped"] and process["streamReadersFinished"])
                record, ordinary, accepted = {}, "", False
                complete = (failure is None and process["directChildReaped"] and process["streamReadersFinished"])
                try:
                    record, ordinary, accepted = terminal(stdout, model, cwd, reads | newly_writable, writes,
                                                          child.returncode, complete)
                except Exception as terminal_error:
                    harvest_errors.append(failure_record(terminal_error))
                accepted = accepted and source_check["sourceAndControlsVerified"] and not harvest_errors
                for name, value in (("process.json", process), ("source-after.json", source_check)):
                    try:
                        save(output / name, value)
                    except OSError as write_error:
                        harvest_errors.append(failure_record(write_error))
                if ordinary:
                    name = "ordinary-handoff.md" if accepted and not harvest_errors else "ordinary-partial.md"
                    try:
                        with (output / name).open("x", encoding="utf-8", newline="\n") as out:
                            out.write(ordinary)
                    except (UnicodeError, OSError) as write_error:
                        harvest_errors.append(failure_record(write_error))
                accepted = accepted and not harvest_errors
                record.update(role=role, source=before["source"], acceptedProcess=accepted, rootDispositionPending=True,
                              rootOwnershipCheckRequired=not accepted, harvestErrors=harvest_errors)
                try:
                    save(output / "terminal.json", record)
                except OSError as write_error:
                    harvest_errors.append(failure_record(write_error))
                    accepted = False
            if failure is not None:
                raise failure
            need(not harvest_errors, "RUN_EVIDENCE_WRITE_OR_HARVEST_FAILED")
            release_lock = accepted
            return 0 if accepted else 1
    except Exception as error:
        if output_owned:
            try:
                save(output / "refusal.json", failure_record(error))
            except OSError:
                pass
        raise
    finally:
        if child is None or release_lock:
            OWNER_LOCK.rmdir()


if __name__ == "__main__":
    need(len(sys.argv) == 3 and sys.argv[1] == "--root-admitted-max-continuation", "ROOT_ROLE_COMMAND_REQUIRED")
    try:
        raise SystemExit(launch(sys.argv[2]))
    except Exception as error:
        print(json.dumps({"status": "MAX_CONTINUATION_BLOCKED", "errorClass": type(error).__name__}), file=sys.stderr)
        raise SystemExit(2) from None
