"""Read committed objects and retained evidence. No product or behavior commands."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile
import io
import json
import re
import subprocess

OUT = Path(__file__).resolve().parent
Q = OUT.parent
W = Path("G:/ggq/gg-i4-363-structured/GraphGoblin")
PUB = Q / "i4-363-publication-01"
INT = Q / "i4-main-a84-integration-01/pr363"
CI = Q / "i4-550-head55c-targeta84-ci"
WIN = Q / "i4-550-head55c-targeta84-ci-windows"
QA = Q / "i4-363-sdk-independent-02"
AUTHOR = Q / "i4-363-sdk-author-01"
HEAD = "55c9a5497f9e4a6e7f9ebeaa29283e3898170683"
BASE = "a84f988b89e456b0e2270e3c4750afb250b6c68f"
TREE = "1108c458b590bbfedfcf3a5e39b1966eb8252e62"
PRE = "6216b9a1397642ae522908ded008f3229608eab8"
SRC = "7d8467439b9850a555b92ab4b96b58c8b8b78388"
ALLOC = "76beeb0f2e99343697578c2713ac06f80d59e7b5"
START = "02351e2fb932b3be44e7cc3fb3943a61d568226c"
MERGE = "7dafb6a54586928199c95c7170780378b5036e19"
OUTCOME = {}


def digest(data):
    return sha256(data).hexdigest()


def dec(data):
    return json.loads(data.decode("utf-8-sig"))


def read(path):
    return dec(Path(path).read_bytes())


def git(*args, input_data=None):
    return subprocess.run(["git", "--no-optional-locks", *args], cwd=W, input=input_data,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout


def names(start, end, *paths):
    return git("diff", "--name-only", start, end, "--", *paths).decode().splitlines()


def blob(revision, path):
    return git("cat-file", "blob", f"{revision}:{path}")


def list_blobs(revision, prefix):
    items = git("ls-tree", "-r", "-z", revision, "--", prefix).split(b"\0")
    paths = {}
    for item in filter(None, items):
        header, path = item.split(b"\t")
        mode, kind, oid = header.split()
        assert mode == b"100644" and kind == b"blob"
        paths[path.decode()] = oid.decode()
    return paths


def all_bytes(paths):
    ids = list(dict.fromkeys(paths.values()))
    content = io.BytesIO(git("cat-file", "--batch", input_data="".join(oid + "\n" for oid in ids).encode()))
    objects = {}
    for oid in ids:
        found, kind, size = content.readline().split()
        assert found.decode() == oid and kind == b"blob"
        value = content.read(int(size))
        assert content.read(1) == b"\n"
        objects[oid] = value
    assert content.read() == b""
    return {path: objects[oid] for path, oid in paths.items()}


def rows_on_disk(manifest_path):
    data = read(manifest_path)
    rows = data if isinstance(data, list) else data["files"]
    assert len({row["path"] for row in rows}) == len(rows)
    for row in rows:
        value = (manifest_path.parent / row["path"]).read_bytes()
        assert len(value) == row["bytes"] and digest(value) == row["sha256"], row
    return len(rows), sum(row["bytes"] for row in rows)


def verify_source():
    expected = {HEAD: [TREE, PRE, BASE], PRE: ["f2f1affef8cb698386200597caa2e7fe3b473df9", SRC],
                SRC: ["00f6f08cebc0e83b257e52e4781f5c85a6c52c1c", ALLOC],
                ALLOC: ["2544bc2913f9cec0d95a215ea631ab62c7985c1d", START]}
    assert git("status", "--porcelain=v1", "-uall") == b""
    assert git("rev-parse", "HEAD").decode().strip() == HEAD
    for rev, binding in expected.items():
        assert git("show", "-s", "--format=%T %P", rev).decode().split() == binding
    assert git("merge-base", HEAD, BASE).decode().strip() == BASE
    receipt = read(PUB / "ROOT-RECEIPT.json")
    pinned = receipt["sourcePreservation"]["exact363RuntimeTestsPatchLockUnchanged"]
    for rec in pinned:
        path = rec["path"]
        a = blob(HEAD, path)
        assert a == blob(PRE, path) == blob(SRC, path) == (W / path).read_bytes()
        assert (len(a), digest(a)) == (rec["bytes"], rec["sha256"])
        assert git("rev-parse", f"{HEAD}:{path}").decode().strip() == rec["oldBlob"]
    assert len(pinned) == 7
    exceptions = receipt["sourcePreservation"]["incoming547CommentOnlyExceptions"]
    assert set(names(PRE, HEAD, "packages", "apps", "patches", "pnpm-lock.yaml")) == {x["path"] for x in exceptions}
    for e in exceptions:
        p = e["path"]
        before, after = blob(PRE, p), blob(HEAD, p)
        assert blob(BASE, p) == after and (digest(before), digest(after)) == (e["beforeSha256"], e["incomingSha256"])
        assert re.sub(rb"/\*\*.*?\*/", b"", before, flags=re.S) == re.sub(rb"/\*\*.*?\*/", b"", after, flags=re.S)
    assert set(names(ALLOC, SRC)) == {line.split("\t")[-1] for line in read(PUB / "source-binding.json")["completeChangedPathsFromParent"]}
    only_current = names(BASE, HEAD, ".", ":(exclude)docs/qa/**")
    assert len(only_current) == 14 and len(names(BASE, HEAD)) == 353
    assert len(names(START, SRC)) == 12
    lock = "pnpm-lock.yaml"
    old_hash = b"3d897be4ca6f078ed158b30bb1a58bc02e1e689560dc658e8bd2d93d27b7338d"
    new_hash = b"119554c3f7cb39db6b24dbb75e9d51fede75171d04aec0114d31356b79693760"
    old_lock, new_lock = blob(ALLOC, lock), blob(HEAD, lock)
    assert old_lock.count(old_hash) == new_lock.count(new_hash) == 3
    assert old_lock.replace(old_hash, new_hash) == new_lock
    patch_path = "patches/@openai__codex-sdk@0.160.0.patch"
    patch = blob(HEAD, patch_path)
    old_patch = blob(ALLOC, patch_path)
    assert digest(patch) == new_hash.decode()
    assert old_patch[old_patch.index(b"@@ -262"):]==patch[patch.index(b"@@ -262"):]
    assert patch.count(b"\n@@") == 2 and old_patch.count(b"\n@@") == 1
    assert blob(ALLOC, "pnpm-workspace.yaml") == blob(HEAD, "pnpm-workspace.yaml")
    assert blob(ALLOC,"packages/adapter-codex/package.json") == blob(HEAD,"packages/adapter-codex/package.json")
    installed = W / "packages/adapter-codex/node_modules/@openai/codex-sdk"
    sdk = (installed / "dist/index.js").read_bytes()
    original = (AUTHOR / "original-sdk.js").read_bytes()
    assert original.count(b'"codex-output-schema-"') == 1
    assert original.replace(b'"codex-output-schema-"', b'"gg-schema-"') == sdk == (AUTHOR / "installed-sdk.js").read_bytes()
    assert digest(sdk) == "ec7471535be310cabbb8f256faa80a1101e46b84b41d42cae40a3e36a9a5feb7"
    assert read(installed / "package.json")["version"] == "0.160.0"
    assert read(installed / "package.json")["license"] == "Apache-2.0"
    out_scope = names(BASE, HEAD, ".github", "tooling", "apps", "package.json", "pnpm-workspace.yaml")
    assert out_scope == []
    OUTCOME["source"] = {"parentsAndTrees": expected, "currentTargetNonArchiveDiff": only_current,
                         "currentTargetTotalPaths": len(names(BASE, HEAD)), "protectedSeven": pinned,
                         "incomingCommentPaths": [e["path"] for e in exceptions], "patchSha256": digest(patch),
                         "oldResolvedSdkSha256": digest(original), "resolvedSdkSha256": digest(sdk),
                         "resolvedSdk": str((installed / "dist/index.js").resolve()),
                         "sourceTreatment": "One new SDK prefix hunk and byte-identical unchanged windowsHide hunk; full SDK and lock checked by replacement."}


def verify_archives():
    receipt = read(PUB / "ROOT-RECEIPT.json")
    packet = {}
    for seal in receipt["sealVerification"]:
        prefix = seal["prefix"]
        pointers = list_blobs(HEAD, prefix)
        assert pointers == list_blobs(seal["sourceCommit"], prefix)
        corpus = {p.removeprefix(prefix): v for p, v in all_bytes(pointers).items()}
        assert len(corpus) == seal["committedRawBlobsVerified"]
        assert all(v == (W / prefix / p).read_bytes() for p, v in corpus.items())
        seal_file = seal["outerSeal"]
        raw = corpus[seal_file]
        assert digest(raw) == seal["outerSealSha256"]
        manifest = dec(raw)
        rows = manifest["files"]
        assert len(rows) == len(corpus)-1 == seal["outerSealListedMembersVerified"]
        assert {r["path"] for r in rows} == set(corpus) - {seal_file}
        for row in rows:
            v = corpus[row["path"]]
            assert (len(v), digest(v)) == (row["bytes"], row["sha256"]), row["path"]
        packet[prefix] = {"sourceCommit": seal["sourceCommit"], "membersIncludingSeal":len(corpus),
                          "listedExcludingSelf":len(rows), "bytesIncludingSeal":sum(map(len,corpus.values())),
                          "outerFile":seal_file, "outerSha256":digest(raw)}
        if "363" in prefix:
            own_corpus = corpus
    mapping = dec(own_corpus["publication-map.json"])
    rows = mapping["members"]
    assert len(rows) == 329 and sum(r["bytes"] for r in rows) == 5840963
    for row in rows:
        v = Path(row["source"]).read_bytes()
        assert v == own_corpus[row["publicPath"]]
        assert (len(v),digest(v)) == (row["bytes"],row["sha256"])
    retained = {Path(r["source"]).resolve() for r in rows}
    for group in mapping["groups"]:
        source_dir = Path(group["sourceRoot"])
        files_in_tree = {x.resolve() for x in source_dir.rglob("*") if x.is_file()}
        assert files_in_tree <= retained, files_in_tree - retained
    source = dec(own_corpus["source-binding.json"])
    current_vs_src = []
    for row in source["currentAuthorFreezeFiles"]:
        assert digest(blob(SRC, row["path"])) == row["sha256"], row["path"]
        current_vs_src.append({"path":row["path"], "sameAtHead":digest(blob(HEAD,row["path"])) == row["sha256"]})
    for row in source["liveSourceAndFixtureBindings"]:
        assert digest(Path(row["path"]).read_bytes()) == row["sha256"], row
    manifests = []
    for rec in source["manifestReplays"]:
        p = Path(rec["source"])
        count, size = rows_on_disk(p)
        assert digest(p.read_bytes()) == rec["sha256"] and (count,size) == (rec["listedMembers"],rec["listedBytes"])
        manifests.append({"location":str(p.relative_to(Q)), "sha256":rec["sha256"], "members":count,"bytes":size})
    assert len(manifests) == 6 and sum(r["members"] for r in manifests) == 330
    assert "root-freeze.py" not in {r["path"] for r in read(AUTHOR / "artifact-sha256.json")}
    coordinator = [m["publicPath"] for m in rows if Path(m["source"]) == AUTHOR / "root-freeze.py"]
    assert len(coordinator) == 1 and coordinator[0].startswith("coordinator/")
    ignore = (PUB / "ignored-copied-members.txt").read_text("utf-8-sig").splitlines()
    assert len(ignore) == 25 and all(line.split("\t")[-1].split("2026-11-21-i4-363-structured-temp/")[-1] in own_corpus for line in ignore)
    assert rows_on_disk(INT / "SHA256SUMS.json")[0] == 49
    assert digest((INT / "SHA256SUMS.json").read_bytes()) == "449e3d4ad576a98e7979d8f3aa30518f5548be1737e429300d9e822fb1074faa"
    assert digest((PUB / "ROOT-RECEIPT.json").read_bytes()) == "ace1fd46bfe8ae16b595c9e1402d6139d93967ed977ff36b847c1ce55b4586f3"
    assert digest((PUB / "publication-receipts.json").read_bytes()) == "c2f64e9954c39bbd0394af813de14764a30821f62c4268c8c4a281fe1eefef13"
    rows_on_disk(PUB / "publication-receipts.json")
    merge_state = read(INT / "merge-state.json")
    assert merge_state["conflicts"] == [".gitattributes", ".prettierignore", "CHANGELOG.md"]
    assert not merge_state["nontrivialRuntimeConflicts"] and merge_state["exit"] == 1
    assert git("merge-base", PRE, BASE).decode().strip() == START
    conflict_proof = []
    for path in merge_state["conflicts"]:
        original_stages = [blob(rev,path) for rev in (START,PRE,BASE)]
        resolved = blob(HEAD,path)
        assert all((INT/"conflicts"/f"{path}.stage{i}").read_bytes()==s for i,s in enumerate(original_stages,1))
        assert (INT/"resolutions"/f"{path}.final").read_bytes() == resolved
        for side in original_stages[1:]:
            words = iter(resolved.split())
            assert all(word in words for word in side.split())
        conflict_proof.append({"path":path,"stagesSha256":[digest(s) for s in original_stages],
                               "resolvedHeadSha256":digest(resolved),"bothParentsTextPreservedInOrder":True})
    publication2 = Q/"i4-reset-review-publications-01"
    public_seal = read(publication2/"SHA256SUMS.json")
    assert len(public_seal["members"])==public_seal["memberCount"]==39
    for rec in public_seal["members"]:
        value=(publication2/rec["path"]).read_bytes()
        assert (len(value),digest(value))==(rec["bytes"],rec["sha256"])
    patterns = {"github":rb"\b(?:gh[pousr]_[A-Za-z0-9]{28,}|github_pat_[A-Za-z0-9_]{30,})",
                "cloudToken":rb"\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{25,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{25,})",
                "privateKey":rb"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----",
                "jwtLikeLiteral":rb"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{12,}"}
    signatures = {k: [p for p,v in own_corpus.items() if re.search(rx,v)] for k,rx in patterns.items()}
    assert all(not values for values in signatures.values())
    OUTCOME["evidence"] = {"archives": packet, "sourceMembers":len(rows), "sourceBytes":sum(r["bytes"] for r in rows),
                           "originalSeals":manifests, "currentFreeze":current_vs_src,
                           "crossCheckedExternalSourceAndFixtureBindings":len(source["liveSourceAndFixtureBindings"]),
                           "addedCoordinatorHelper":coordinator[0], "scopedExplicitlyTrackedLogCount":len(ignore),
                           "integrationSha256":digest((INT / "SHA256SUMS.json").read_bytes()),
                           "integrationMembers":49, "conflictResolutionProof":conflict_proof,
                           "detachedRootReceiptSha256":digest((PUB/"ROOT-RECEIPT.json").read_bytes()),
                           "publicBodyReceiptSha256":digest((PUB / "publication-receipts.json").read_bytes()),
                           "correctiveReviewPublicationReceiptSha256":digest((publication2/"publication-receipts.json").read_bytes()),
                           "correctivePublicationSealSha256":digest((publication2/"SHA256SUMS.json").read_bytes()),
                           "archiveSignatureScan":signatures, "signatureScope":"Named formats in 339 added committed blobs only. No external secret lookup."}


def verify_opus():
    envelope = []
    for num, expected in [(1, "efab11b92aa1f406d9d53eef4334b05cca4de1f485293d851a173246b3d6949a"),
                           (2, "1c01ec92fbd9e526c35366781824c3f27890a43148dfb345a8c82cd99f982993")]:
        parent = Q / f"i4-363-opus-review-0{num}"
        directory = parent / "provider"
        events = [json.loads(s) for s in (directory / "events.jsonl").read_text("utf-8").splitlines() if s.strip()]
        launch, result, exit_record = (read(directory / f) for f in ["launch.json","result.json","exit.json"])
        report = (directory / "provider-final-message.md").read_bytes()
        assert result["result"].encode() == report and digest(report) == expected
        terminals = [e for e in events if e.get("type") == "result"]
        assert terminals == [result] and events[-1] == result
        assert exit_record["code"] == 0 and result["is_error"] is False and result["terminal_reason"] == "completed"
        assert set(result["modelUsage"]) == {"claude-opus-5-5"} and launch["model"] == "claude-opus-5-5" and launch["effort"]=="xhigh"
        assert result["modelUsage"]["claude-opus-5-5"]["outputTokens"] > 0
        envelope.append({"slot":num, "source":ALLOC if num==1 else SRC, "verdict":"CHANGES_REQUIRED" if num==1 else "ACCEPT CORRECTION",
                         "actualModelUsage":list(result["modelUsage"]), "launchEffort":launch["effort"], "sessionId":result["session_id"],
                         "reportSha256":expected, "eventCount":len(events), "finishedAt":exit_record["finishedAt"],"exit":0})
    assert envelope[0]["sessionId"] != envelope[1]["sessionId"]
    OUTCOME["formalReviews"] = envelope


def verify_behavior():
    orig = read(Q / "i4-363-independent-01/observations.json")
    assert (orig["final"]["pass"],orig["final"]["fail"],len(orig["cases"])) == (19,0,19)
    boundary = read(Q / "i4-363-sdk-boundary-01/observations.json")
    assert (boundary["final"]["pass"],boundary["final"]["fail"]) == (0,2)
    short,long = (c["state"] for c in boundary["cases"])
    assert short["turnExists"] and short["outcome"]["kind"] == "resolved"
    assert long["tempLength"]==226 and long["listingExists"] and not long["turnExists"] and "ENAMETOOLONG" in str(long["outcome"])
    assert all(not s["scratchExistsAfter"] and s["tempEntriesAfter"]==["tsx-98jak"] for s in [short,long])
    assert read(QA / "source-binding.json")["head"] == SRC
    author_cases = read(AUTHOR / "source-replay-result.json")["observations"]
    assert len(author_cases)==6 and all(c["pass"] for c in author_cases)
    coverage = read(AUTHOR / "adapter-coverage-summary.json")["total"]
    assert (coverage["lines"]["pct"],coverage["branches"]["pct"]) == (99.41,95.5)
    cases = []
    requests = 0
    driver_outcomes = []
    for folder,expected in [(QA,(0,8)),(QA/"native-corrected-01",(2,0)),(QA/"abort-corrected-01",(0,2))]:
        doc = read(folder / "observations.json")
        assert (doc["final"]["pass"],doc["final"]["fail"]) == expected
        driver_outcomes.append({"path":str(folder.relative_to(Q)), "pass":expected[0],"fail":expected[1]})
        for statefile in sorted((folder/"raw").glob("*.state.json")):
            s=read(statefile)
            cfg=read(statefile.with_name(statefile.name.replace(".state.json",".config.json")))
            assert s["platform"]=="win32" and s["node"]=="v22.23.4"
            assert s["before"] == s["after"] and len(s["sentinelContents"])==3 and all(x["actual"]==x["expected"] for x in s["sentinelContents"])
            assert s["scratchExistsAfter"] is False and s["schemaDirExistsAfter"] is False and len(s["unexpectedRequests"])==0
            r=s["requests"]
            native=s["tier"]=="native"
            assert len(r)==int(native)
            requests+=len(r)
            obs=r[0] if native else s["turn"]
            assert obs["schema"]==cfg["schema"]==json.loads(obs["schemaText"])
            assert digest(obs["schemaText"].encode())==obs["schemaSha256"]
            lengths=[obs["scratchLength" if native else "cwdLength"],obs["schemaDirLength"],obs["schemaFileLength"]]
            if cfg["root"]=="226": assert s["tempLength"]==226 and lengths==[249,243,255]
            outcome=s["outcome"]
            proof={"folder":str(folder.relative_to(Q)), "case":s["id"], "tier":s["tier"],"tempLength":s["tempLength"],"lengths":lengths,
                   "productOutcome":outcome["kind"], "nativeRequests":len(r),"fixtureStatus":next(c["status"] for c in doc["cases"] if c["id"]==s["id"])}
            if native:
                req=r[0];fmt=req["body"]["text"]["format"]
                assert req["method"]=="POST" and req["url"]=="/v1/responses" and fmt["strict"] and fmt["type"]=="json_schema" and fmt["schema"]==cfg["schema"]
                assert outcome["value"]["value"]=={"proof":"sdk363","ok":True}
                if folder != QA:
                    turn = [c for c in s["children"] if "--output-schema" in c["args"]][0]
                    assert turn["spawned"] and turn["exited"] and turn["exitCode"]==0 and turn["signal"] is None
                    assert Path(turn["executable"]).name=="codex.exe" and turn["args"][turn["args"].index("--output-schema")+1]==req["schemaPath"]
                    assert turn["args"][turn["args"].index("--cd")+1]==req["scratch"]
                    assert not s["liveHandles"]
                    proof.update({"pid":turn["pid"],"exitCode":0,"strictSchema":True})
            elif s["mode"]=="abort":
                if folder==QA:
                    assert "ERR_MODULE_NOT_FOUND" in outcome["error"]["message"] and outcome["error"]["name"]!="AbortError"
                    proof["disposition"]="invalid original abort fixture"
                else:
                    obs=s["abortObservation"]
                    assert obs["scratchExists"] and obs["schemaFileExists"] and outcome["error"]["name"]=="AbortError"
                    assert any(h["pid"]==obs["pid"] and h["signalCode"]=="SIGTERM" for h in s["handleTermination"])
                    assert s["liveHandles"]==[] and not next(c for c in s["children"] if c["pid"]==obs["pid"]).get("exited")
                    proof.update({"signalCode":"SIGTERM","exitEventObserved":False,"liveHandles":[]})
            else:
                assert outcome["kind"]==("resolved" if s["mode"]=="success" else "rejected")
            cases.append(proof)
    cim = read(QA / "raw/final-owned-process-readback-02.json")
    assert cim["count"]==0 and cim["knownPidsPresentNow"]==[] and cim["knownPidCount"]==32 and len(cim["ownedRoots"])==3
    assert len(cases)==12 and requests==4
    OUTCOME["behavior"]={"allocatorControls":len(orig["cases"]), "originalBoundaryDriver":[0,2],
                         "authorReplay":author_cases, "authorCoverage":{"lines":coverage["lines"]["pct"],"branches":coverage["branches"]["pct"]},
                         "independentDriverOutcomes":driver_outcomes, "independent12Calls":cases,
                         "totalSyntheticNativeRequests":requests, "D183AcceptedScenarios":8,
                         "scopedCimKnownPids":cim["knownPidCount"],"scopedCimOwnedRoots":len(cim["ownedRoots"])}


def verify_ci():
    sealed = read(CI / "files.json")
    assert all(digest((CI/p).read_bytes())==v for p,v in sealed.items())
    jobs = {r["name"]:r for r in read(CI / "jobs.json")["jobs"]}
    assert len(jobs)==6 and all(j["conclusion"]=="success" and j["run_attempt"]==1 for j in jobs.values())
    allow_skips={"Upload browser failure evidence"}
    skipped=[s["name"] for j in jobs.values() for s in j["steps"] if s["conclusion"]=="skipped"]
    for job in jobs.values():
        assert all(s["conclusion"] in ("success","skipped") for s in job["steps"])
    assert set(skipped) <= allow_skips, skipped
    def log_text(name):
        return re.sub(r"\x1b\[[0-9;]*m", "", (CI/name).read_text("utf-8-sig"))
    cover=log_text("coverage.log")
    cases=re.findall(r"\bTests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?\s*\(",cover)
    assert sum(int(n) for n,_ in cases)==10049 and sum(int(n or 0) for _,n in cases)==52
    assert re.search(r"Tasks:\s*22 successful,\s*22 total",cover)
    assert re.search(r"\b488 passed \(", log_text("browser.log"))
    nw=log_text("windows-launcher.log")
    assert "# pass 27" in nw and "# fail 0" in nw
    checklog=log_text("repository-checks.log")
    assert "Severity: 7 low | 13 moderate" in checklog and "Licence allowlist: OK" in checklog
    coverage={}
    with ZipFile(CI/"coverage.zip") as z:
        for f in z.namelist():
            totals=dec(z.read(f))["total"]
            coverage[f]={k:totals[k]["pct"] for k in ("lines","branches","functions","statements")}
        assert len(coverage)==13 and min(min(v.values()) for v in coverage.values())>=90
    native = read(WIN/"verified.json")
    raw=(WIN/"archive.zip").read_bytes(); assert digest(raw)==native["digest"]=="357d01a5ba9ad144cb84974be96a8b4013ac17ddfc5500ad7f10c4ac3f4d0b61"
    rp=read(WIN / "replay/replay-results.json"); fixture=Path(rp["cases"][0]["fixture"])
    assert digest(blob(HEAD,"tooling/scripts/windows-launcher-evidence.mjs"))==rp["sha256"]
    with ZipFile(io.BytesIO(raw)) as z:
        assert set(z.namelist())==set(native["files"]) and len(z.namelist())==3
        members={n:z.read(n) for n in z.namelist()}
    for n,b in members.items():
        assert digest(b)==native["files"][n] and b==(WIN/"corpus"/n).read_bytes()
    man,res=dec(members["manifest.json"]),dec(members["result.json"])
    bind=man["binding"];assert (bind["eventHead"],bind["eventBase"],bind["checkout"]["tree"],bind["sha"])==(HEAD,BASE,TREE,MERGE)
    assert bind["checkout"]["head"] == MERGE and bind["checkout"]["parents"]==[BASE,HEAD] and bind["runId"]=="44894502596" and bind["runAttempt"]=="1"
    assert bind["runnerOs"]=="Windows" and bind["runnerArch"]=="X64"
    obs=[json.loads(x) for x in members["observations.ndjson"].splitlines()]
    assert len(obs)==338 and [r["seq"] for r in obs]==list(range(1,339))
    assert Counter(r["type"] for r in obs)==res["observations"]["byType"]
    assert res["evidenceId"]==man["evidenceId"]==obs[0]["evidenceId"]
    assert res["status"]=="complete" and res["observations"]["state"]=="valid" and res["observations"]["omittedRecords"]==res["observations"]["rejected"]==0
    assert res["steps"]=={"install":"success","build":"success","native":"success"}
    assert all(c["result"]=="pass" and c["subtestsFailed"]==0 and c["subtestsUnpaired"]==0 for c in res["cases"].values())
    assert rp["cases"][0]["exactResultReplay"] and rp["cases"][0]["records"]==338
    assert all((fixture/n).read_bytes()==b for n,b in members.items())
    OUTCOME["CI"]={"run":44894502596,"attempt":1,"sealedFiles":len(sealed),"merge":MERGE, "jobs":{n:[s["name"] for s in j["steps"] if s["conclusion"]=="success"] for n,j in jobs.items()},
                   "skippedConditionalSteps":skipped,"unitPassed":10049,"unitSkipped":52,"browserPassed":488,"nativeWindowsPassed":27,
                   "coverageTasks":22,"coverageSummaries":coverage,"audit":{"low":7,"moderate":13,"high":0,"critical":0},
                   "nativeArtifact":{"id":native["artifact"],"digest":digest(raw),"size":len(raw),"members":native["files"],"binding":bind,
                                    "records":len(obs),"replayHelperSha256":rp["sha256"],"replayCanonicalComparison":"All three stored replay outputs equal the original archive member bytes, including result.json."}}


if __name__=="__main__":
    for check in (verify_source,verify_archives,verify_opus,verify_behavior,verify_ci):
        check()
        print(check.__name__,"verified",flush=True)
    OUTCOME["verifiedAtUtc"]=datetime.now(timezone.utc).isoformat()
    (OUT/"source-evidence-binding.json").write_text(json.dumps(OUTCOME,indent=2)+"\n",encoding="utf-8",newline="\n")
