"""Capture the live GitHub gates, checking local/public review bytes without mutation."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import subprocess

OUT = Path(__file__).resolve().parent
Q = OUT.parent
W = Path("G:/ggq/gg-i4-363-structured/GraphGoblin")
OWNER = "Jacob-J-Thomas"
REPO = "/".join([OWNER, "GraphGoblin"])
GH = f"repos/{REPO}"
HEAD = "55c9a5497f9e4a6e7f9ebeaa29283e3898170683"
BASE = "a84f988b89e456b0e2270e3c4750afb250b6c68f"
MERGE = "7dafb6a54586928199c95c7170780378b5036e19"
TREE = "1108c458b590bbfedfcf3a5e39b1966eb8252e62"
RUN = 44894502596


def h(b):
    return sha256(b).hexdigest()


def read(p):
    return json.loads(p.read_bytes().decode("utf-8-sig"))


def request(args):
    out = subprocess.run(["gh", "api", *args], cwd=W, capture_output=True, check=True)
    return json.loads(out.stdout)


query = """query{repository(owner:"Jacob-J-Thomas",name:"GraphGoblin"){
  ref(qualifiedName:"refs/heads/main"){target{oid}}
  pullRequest(number:550){number state title isDraft headRefName headRefOid baseRefName baseRefOid mergeable mergeStateStatus reviewDecision
    body url potentialMergeCommit{oid tree{oid} parents(first:3){nodes{oid}}}
    closingIssuesReferences(first:30){nodes{number state} pageInfo{hasNextPage}}
    reviewThreads(first:100){nodes{isResolved isOutdated comments(first:10){nodes{author{login} url}}} pageInfo{hasNextPage}}
    reviews(first:100){nodes{state author{login} commit{oid}} pageInfo{hasNextPage}}
    comments(first:100){nodes{databaseId author{login} url body createdAt updatedAt} pageInfo{hasNextPage}}
  }
  issue(number:363){number state title body url parent{number state}
    labels(first:100){nodes{name} pageInfo{hasNextPage}}
    comments(first:100){nodes{databaseId author{login} url body createdAt updatedAt} pageInfo{hasNextPage}}
  }
}}"""
with ThreadPoolExecutor(max_workers=5) as ex:
    args = {
        "prAndIssue": ["graphql", "-f", "query=" + query],
        "run": [f"{GH}/actions/runs/{RUN}"],
        "jobs": [f"{GH}/actions/runs/{RUN}/attempts/1/jobs?per_page=100"],
        "artifacts": [f"{GH}/actions/runs/{RUN}/artifacts?per_page=100"],
        "statusChecks": [f"{GH}/commits/{HEAD}/check-runs?per_page=100"],
        "actualMergeObject": [f"{GH}/git/commits/{MERGE}"],
        "signedMain": [f"{GH}/git/commits/{BASE}"],
    }
    pending = {label:ex.submit(request, arg) for label,arg in args.items()}
    result = {label:future.result() for label,future in pending.items()}
root = result["prAndIssue"]["data"]["repository"]
pr, issue = root["pullRequest"], root["issue"]
assert (pr["state"], pr["isDraft"], pr["baseRefName"], pr["headRefOid"], pr["baseRefOid"], root["ref"]["target"]["oid"]) == ("OPEN",True,"main",HEAD,BASE,BASE)
assert pr["mergeable"]=="MERGEABLE" and pr["mergeStateStatus"]=="CLEAN"
for obj,k in [(pr,k) for k in ("closingIssuesReferences","reviewThreads","reviews","comments")]+[(issue,"labels"),(issue,"comments")]:
    assert not obj[k]["pageInfo"]["hasNextPage"]
assert pr["closingIssuesReferences"]["nodes"]==[{"number":363,"state":"OPEN"}]
assert pr["reviewThreads"]["nodes"]==pr["reviews"]["nodes"]==[] and pr["reviewDecision"] is None
assert "Closes #363" in pr["body"] and "Part of #279" in pr["body"]
assert pr["potentialMergeCommit"]["oid"] == MERGE
assert result["actualMergeObject"]["tree"]["sha"]==TREE and [p["sha"] for p in result["actualMergeObject"]["parents"]]==[BASE,HEAD]
labels=[n["name"] for n in issue["labels"]["nodes"]]
assert all(x in labels for x in ("aidlc-ready","qa:touched-systems","impl:gpt-6.1-sol","review:claude-opus-5.5"))
assert not set(labels)&{"human-in-the-loop","needs-plan-approval","needs-refinement","backlog"}
assert issue["state"]=="OPEN"
comments={c["databaseId"]:c for obj in [pr,issue] for c in obj["comments"]["nodes"]}
originals=read(Q/"i4-363-publication-01/publication-receipts.json")
body_results=[]
for rec in originals["posts"]:
    c=comments[rec["id"]]; assert c["body"].encode()==Path(rec["sourcePath"]).read_bytes()
    body_results.append({"id":rec["id"],"sha256":h(c["body"].encode()),"url":c["url"],"kind":rec["kind"]})
second=comments[7061723533]
assert second["body"].encode()==(Q/"i4-363-opus-review-02/provider/provider-final-message.md").read_bytes()==(Q/"i4-reset-review-publications-01/363/report.verbatim.md").read_bytes()
body_results.append({"id":7061723533,"sha256":h(second["body"].encode()),"url":second["url"],"kind":"actual corrective Opus, original verbatim"})
published=read(Q/"i4-550-current-ci-publication.json")
c=comments[7061548828]
assert c["body"]==published["input"]["comment"]==published["readback"]["body"]
body_results.append({"id":7061548828,"sha256":h(c["body"].encode()),"url":c["url"],"kind":"current CI"})
pub2=read(Q/"i4-reset-review-publications-01/363/context-input.json")
context=next(c for c in pr["comments"]["nodes"] if c["body"]==pub2["writeArguments"]["comment"])
body_results.append({"id":context["databaseId"],"sha256":h(context["body"].encode()),"url":context["url"],"kind":"separate corrective publication context"})
run=result["run"]; assert (run["id"],run["run_attempt"],run["head_sha"],run["event"],run["conclusion"])==(RUN,1,HEAD,"pull_request","success")
jobs=result["jobs"]["jobs"];assert len(jobs)==result["jobs"]["total_count"]==6
assert all(j["run_id"]==RUN and j["run_attempt"]==1 and j["status"]=="completed" and j["conclusion"]=="success" for j in jobs)
retained=read(Q/"i4-550-head55c-targeta84-ci/jobs.json")["jobs"]
assert [(j["id"],j["name"],j["conclusion"]) for j in jobs]==[(j["id"],j["name"],j["conclusion"]) for j in retained]
checks=result["statusChecks"]["check_runs"]
assert result["statusChecks"]["total_count"]==6 and {j["name"] for j in checks}=={j["name"] for j in jobs}
assert all(j["conclusion"]=="success" for j in checks)
objects=result["artifacts"]["artifacts"];assert len(objects)==2
artifact=next(a for a in objects if a["id"]==14703338512)
assert artifact["digest"]=="sha256:357d01a5ba9ad144cb84974be96a8b4013ac17ddfc5500ad7f10c4ac3f4d0b61"
coverage=next(a for a in objects if a["id"]!=14703338512)
assert coverage["digest"]=="sha256:"+h((Q/"i4-550-head55c-targeta84-ci/coverage.zip").read_bytes())
assert not any(a["expired"] for a in objects)
binding={"capturedAtUtc":datetime.now(timezone.utc).isoformat(), "pr":pr["number"], "head":HEAD,"base":BASE,"testedMerge":MERGE,"tree":TREE,
         "ordinaryGitHubReviews":0, "reviewThreads":0,"state":pr["state"],"draft":pr["isDraft"],"mergeable":pr["mergeable"],"mergeState":pr["mergeStateStatus"],
         "closingIssues":pr["closingIssuesReferences"]["nodes"],"issueLabels":labels,"issueNativeParent":issue["parent"],"baseSignature":result["signedMain"]["verification"]["verified"],
         "issueCommentsInspected":[{"id":c["databaseId"],"url":c["url"],"createdAt":c["createdAt"]} for c in issue["comments"]["nodes"]],
         "authoritativeCommentBodyComparisons":body_results,"run":RUN,"attempt":run["run_attempt"], "checks": {j["name"]:j["conclusion"] for j in jobs},
         "artifacts":[{"id":a["id"],"name":a["name"],"digest":a["digest"],"bytes":a["size_in_bytes"]} for a in objects]}
for name, obj in [("live-github-binding.json",binding),("live-github-snapshot.json",result)]:
    (OUT/name).write_text(json.dumps(obj,indent=2)+"\n",encoding="utf-8",newline="\n")
print(pr["headRefOid"],pr["baseRefOid"],RUN,"6 success jobs;",len(body_results),"comment bodies independently confirmed")
