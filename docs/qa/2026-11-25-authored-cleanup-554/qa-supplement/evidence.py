"""Read-only reconstruction of the immutable original #554 independent QA evidence."""
from collections import Counter
from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path, PurePosixPath
import re
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
QA = HERE.parent / "independent-qa-01"
AUTHOR = HERE.parent / "claude-implementation-01"
REVIEW = HERE.parent / "review-01"
E = HERE.parents[1]
SHARED = E / "scope-preparation-01"
PATCH = "4f40ceb69211a9f8fab0d7d18e6b21894ecc4136bcbf25548d98094c93885e9a"
INDEX = "c646b19521a2037a20f09903e123e2f6fd4f52cc504a425c764666766519b55a"
MODEL = "claude-opus-5-5"
DOC = "docs/05-execution-engine.md"
AUTHORED = "packages/engine/src/authored-failure.ts"
SECTIONS = {
    DOC: (479, 521),
    "docs/04-node-catalog.md": (205, 213),
    "docs/07-api-and-streaming.md": (96, 108),
    AUTHORED: None,
    "packages/engine/src/handlers/mutate.ts": None,
    "packages/engine/src/handlers/common.ts": None,
    "packages/engine/src/failure-publication.ts": None,
    "packages/engine/src/errors.ts": (35, 70),
    "packages/engine/src/event-validation.ts": None,
    "packages/engine/src/handler.ts": (52, 88),
    "packages/engine/src/run-manager.ts": ((2593, 2706), (3063, 3099)),
    "packages/domain/src/mutations.ts": ((210, 232), (318, 356)),
    "packages/engine/src/handlers/mutation-failures.test.ts": (71, 115),
}
UNCHANGED = (
    "packages/engine/src/handlers/mutate.ts",
    "packages/engine/src/handlers/common.ts",
    "packages/engine/src/failure-publication.ts",
    "packages/engine/src/errors.ts",
    "packages/engine/src/event-validation.ts",
    "docs/04-node-catalog.md",
)
QA_ATTACHMENTS = (
    "QA-CONFIG.json", "QA-BRIEF.md", "QA-REPORT.claude.md",
    "CLAUDE-LAUNCH.json", "CLAUDE-EXIT.json",
    "FROZEN-BEFORE.json", "FROZEN-AFTER.json", "SOURCE-BINDINGS.json",
    "DOMAIN-RESULT.json", "ENGINE-RESULT.json", "CONTROLS-RESULT.json",
    "domain.stdout.log", "domain.stderr.log", "engine.stdout.log", "engine.stderr.log",
    "controls.stdout.log", "controls.stderr.log",
    "failure-controls.mts", "run-check.py",
)


def need(condition, label):
    if not condition:
        raise RuntimeError(label)


def sha(content):
    return sha256(content).hexdigest()


def digest(path):
    return sha(path.read_bytes())


def read(path):
    return json.loads(path.read_bytes())


def save(path, value):
    with path.open("xb") as stream:
        stream.write((json.dumps(value, indent=2, ensure_ascii=True) + "\n").encode("utf-8"))


def load_qa():
    sys.path.insert(0, str(QA))
    spec = spec_from_file_location("original_qa_554", QA / "run-check.py")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def system_init(path):
    with path.open(encoding="utf-8") as stream:
        records = [row for line in stream if line.strip()
                   for row in [json.loads(line)]
                   if row.get("type") == "system" and row.get("subtype") == "init"]
    need(len(records) == 1, f"UNEXPECTED_PROVIDER_INIT_COUNT {path.name}")
    row = records[0]
    need(row.get("model") == MODEL and row.get("apiKeySource") == "none"
         and row.get("session_id"), f"ORIGINAL_PROVIDER_IDENTITY_UNPROVEN {path.name}")
    return row


def source_sections(repo):
    excerpt_hashes = {}
    excerpts = {}
    full_hashes = {}
    for path, scope in SECTIONS.items():
        raw = (repo / path).read_bytes()
        full_hashes[path] = sha(raw)
        lines = raw.decode("utf-8").splitlines(keepends=True)
        ranges = ((1, len(lines)),) if scope is None else (scope,) if isinstance(scope[0], int) else scope
        for start, end in ranges:
            need(1 <= start <= end <= len(lines), f"INVALID_SOURCE_RANGE {path} {start}-{end}")
            name = f"{path}:{start}-{end} of {len(lines)}"
            body = "".join(lines[start - 1:end]).encode("utf-8")
            excerpts[name] = body
            excerpt_hashes[name] = sha(body)
    return excerpts, excerpt_hashes, full_hashes


def baseline_proof(check, env, source):
    proof = {}
    for path in UNCHANGED:
        need(path not in source["changedFilesSha256"], f"ORDINARY_PATH_CHANGED {path}")
        original = check.git(env, "cat-file", "blob", f"{source['head']}:{path}")
        blob = check.git_text(env, "rev-parse", f"{source['head']}:{path}")
        working = (check.WORKTREE / path).read_bytes()
        normalized = working.replace(b"\r\n", b"\n")
        need(working == original or normalized == original, f"ORDINARY_PATH_DIVERGENCE {path}")
        proof[path] = {"gitBlob": blob, "gitBlobContentSha256": sha(original),
                       "workingFileSha256": sha(working),
                       "identity": "exact bytes" if working == original else "exact after CRLF-to-LF only"}
    return proof


def visible(stdout):
    return re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", stdout.decode("utf-8"))


def assemble():
    check = load_qa()
    env = check.environment()
    source = check.snapshot(env)
    for name in ("PREPARED-CANDIDATE.json", "FROZEN-BEFORE.json", "FROZEN-AFTER.json"):
        need(source == read(QA / name), f"SOURCE_DRIFT {name}")
    need(source["patchSha256"] == PATCH and source["indexSha256"] == INDEX
         and len(source["changedFilesSha256"]) == 11 and not source["stagedPaths"]
         and not source["untrackedPaths"], "FROZEN_CANDIDATE_UNPROVEN")
    raw = {name: (QA / name).read_bytes() for name in QA_ATTACHMENTS}
    terminal = json.loads(raw["CLAUDE-EXIT.json"])
    launch = json.loads(raw["CLAUDE-LAUNCH.json"])
    bindings = json.loads(raw["SOURCE-BINDINGS.json"])
    need(terminal["sourceUnchanged"] and terminal["requiredChecksPassed"]
         and terminal["requiredToolScopeObserved"] and terminal["invocationSucceeded"]
         and not terminal["permissionDenials"] and terminal["usingOverage"] is False,
         "ORIGINAL_QA_EXECUTION_UNPROVEN")
    need(launch["nodeVersion"] == "v22.23.4" and launch["pnpmVersion"] == "12.8.1"
         and launch["effort"] == "xhigh" and launch["model"] == MODEL and launch["auth"] == {
             "loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty",
             "subscriptionType": "max", "apiKeySource": None,
         }, "ORIGINAL_QA_PREFLIGHT_UNPROVEN")
    need(launch["patchSha256"] == PATCH and launch["baseHead"] == source["head"]
         and terminal["patchSha256"] == PATCH and bindings["candidate"] == source
         and bindings["runnerSha256"] == sha(raw["run-check.py"])
         and sha(raw["failure-controls.mts"]) == source["driverSha256"],
         "ORIGINAL_QA_SOURCE_BINDINGS_UNPROVEN")
    qa_session = system_init(QA / "CLAUDE-EVENTS.private.jsonl")["session_id"]
    author_session = system_init(AUTHOR / "CLAUDE-EVENTS.private.jsonl")["session_id"]
    need(qa_session != author_session and qa_session == terminal["providerSessionId"], "ORIGINAL_SESSIONS_UNPROVEN")
    prior_prompt = (QA / "CLAUDE-BRIEF.private.txt").read_bytes()
    need(sha(prior_prompt) == launch["promptSha256"], "ORIGINAL_QA_PROMPT_UNBOUND")
    need(re.search(rb"docs/05-execution-engine.md \(1100\xe2\x80\x93813\)\s*\Z", prior_prompt)
         is not None, "ORIGINAL_EMPTY_EXCERPT_UNPROVEN")
    driver_text = raw["failure-controls.mts"].decode("utf-8-sig").replace("\r\n", "\n")
    need(driver_text in prior_prompt.decode("utf-8"), "ORIGINAL_DRIVER_PROMPT_ATTACHMENT_UNPROVEN")
    need("Documentation identifiers | BLOCKED" in raw["QA-REPORT.claude.md"].decode("utf-8"),
         "ORIGINAL_DOCUMENTATION_BLOCK_UNPROVEN")

    observed_checks = {}
    for mode in ("domain", "engine", "controls"):
        report_name = f"{mode.upper()}-RESULT.json"
        report = json.loads(raw[report_name])
        attachment = terminal["checkReceipts"][mode]
        need(attachment["file"] == report_name and attachment["sha256"] == sha(raw[report_name])
             and attachment["exitCode"] == report["exitCode"] == 0
             and attachment["sourceUnchanged"] is report["sourceUnchanged"] is True
             and report["patchSha256"] == PATCH and report["command"] == check.CHECKS[mode],
             f"QA_COMMAND_RECEIPT_UNPROVEN {mode}")
        counts = {}
        for stream in ("stdout", "stderr"):
            name = f"{mode}.{stream}.log"
            payload = raw[name]
            need(report[stream] == {"file": name, "bytes": len(payload), "sha256": sha(payload)},
                 f"QA_STREAM_UNBOUND {name}")
            counts[f"{stream}Bytes"] = len(payload)
        observed_checks[mode] = counts

    for mode, files, tests in (("domain", 1, 26), ("engine", 4, 140)):
        output = visible(raw[f"{mode}.stdout.log"])
        need(re.search(rf"Test Files\s+{files} passed \({files}\)", output)
             and re.search(rf"Tests\s+{tests} passed \({tests}\)", output),
             f"ORIGINAL_VITEST_COUNTS_UNPROVEN {mode}")
        observed_checks[mode].update(filesPassed=files, testsPassed=tests)
    controls = json.loads(raw["controls.stdout.log"])
    need(len(controls["cases"]) == controls["total"] == 10
         and all(row["exactIdentity"] and row["ordinaryMapper"] and not row["authoredAttribution"]
                 for row in controls["cases"][:7])
         and all(controls["cases"][i][key] for i, key in
                 ((7, "exactPatch"), (8, "repair"), (9, "genuineAuthoredFact"))),
         "ORIGINAL_SYNTHETIC_CONTROL_RECEIPT_UNPROVEN")
    observed_checks["controls"]["total"] = 10

    excerpts, excerpt_hashes, full_hashes = source_sections(check.WORKTREE)
    for path, value in bindings["sourcePacketFilesSha256"].items():
        need(digest(check.WORKTREE / path) == value, f"ORIGINAL_SOURCE_PACKET_UNBOUND {path}")
    doc = next(value.decode("utf-8") for name, value in excerpts.items() if name.startswith(DOC + ":"))
    authored = (check.WORKTREE / AUTHORED).read_text(encoding="utf-8")
    fields_map = authored.split("const fields = {", 1)[1].split("} as const;", 1)[0]
    fields = re.findall(r"^\s*'([a-zA-Z.]+)':", fields_map, re.M)
    table = "\n".join(line.split("|")[1] for line in doc.splitlines()
                      if line.startswith("| " + chr(96)) and not line.startswith("| " + chr(96) + "details.boundary"))
    ids = re.findall(chr(96) + r"([a-zA-Z.]+)" + chr(96), table)
    need(len(fields) == len(ids) == len(set(ids)) == 27 and Counter(ids) == Counter(fields),
         "DOCUMENTED_BOUNDARIES_DO_NOT_EXACTLY_MATCH_MAP")
    proof = {
        "originalQaDisposition": "Documentation identifiers BLOCKED; three exact original approvals executed successfully",
        "originalProviderSessions": {"author": author_session, "independentQa": qa_session},
        "originalQaBeforeAfterAndCurrentCandidateEqual": source,
        "originalFailedPromptSelection": {"requested": [1100, 1128], "emittedHeading": [1100, 813],
                                          "emittedSourceLines": 0, "promptSha256": sha(prior_prompt)},
        "originalMedia": observed_checks,
        "originalRunnerPreflight": {"node": launch["nodeVersion"], "pnpm": launch["pnpmVersion"],
                                    "scope": "same launcher environment before child checks; no per-child runtime output"},
        "driverSha256MatchedBeforeAfterCurrentAndPromptAttachment": source["driverSha256"],
        "unchangedPolicyBlobProof": baseline_proof(check, env, source),
        "docsBoundaryCount": len(ids), "fieldsMapCount": len(fields), "exactSetOnceEach": True,
        "sourceExcerptFullFileSha256": full_hashes, "sourceExcerptsSha256": excerpt_hashes,
        "historicalFormalReview": {"tier": "independent formal review 1, separate from QA",
                                  "reportSha256": digest(REVIEW / "REVIEW.md"),
                                  "candidatePatchSha256": digest(REVIEW / "candidate.patch")},
        "notRunByPreparation": ["test", "build", "browser", "model", "provider auth", "formal review"],
    }
    need(proof["historicalFormalReview"]["candidatePatchSha256"] == PATCH, "HISTORICAL_FORMAL_PATCH_UNBOUND")
    return proof, raw, excerpts

