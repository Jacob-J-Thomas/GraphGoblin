from pathlib import Path
import json, hashlib
from datetime import datetime,timezone
root=Path(r"C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-486-plan-publication-01")
def sha(b): return hashlib.sha256(b).hexdigest()
def load(p): return json.loads(p.read_bytes())
def unpack(p): return json.loads(load(p)["structuredContent"]["content"])
def write(p,x): p.write_bytes((json.dumps(x,ensure_ascii=False,indent=2)+"\n").encode("utf-8"))
v=load(root/"validation.json")
for item in v["originals"]:
    source=Path(item["source"]).read_bytes();copy=(root/item["copy"]).read_bytes()
    assert source==copy and len(source)==item["bytes"] and sha(source)==item["sha256"]
items=load(root/"publication-items.json");comments=[]
for item in items:
    raw=unpack(root/item["key"]/"readback.json");body=raw["body"].encode("utf-8")
    assert body==item["body"].encode("utf-8")
    assert sha(body)==item["publicationBodySha256"]
    assert body[len(item["prefix"].encode("utf-8")):]==Path(item["source"]).read_bytes()
    comments.append({"key":item["key"],"title":item["title"],"id":raw["id"],"url":raw["html_url"],"sourceSha256":item["sourceSha256"],"publicBodySha256":sha(body),"freshGetExactUtf8Bytes":True,"editorialPrefixBytes":len(item["prefix"].encode("utf-8"))})
before=unpack(root/"issue-pre-update.json");final=unpack(root/"issue-final-readback.json")
body_input=load(root/"issue-body-input.json")
assert final["body"]==body_input["arguments"]["body"]
assert final["body"]==before["body"]+body_input["appendix"]
before_labels=sorted(x["name"] for x in before["labels"]);final_labels=sorted(x["name"] for x in final["labels"])
assert final_labels==[x for x in before_labels if x!="needs-plan-approval"]
assert "aidlc-ready" in final_labels and "plan-approved" not in final_labels
r={"kind":"Administrative plan-publication/admission receipt; connector inputs/results/fresh GET response bodies retained, not raw HTTP transport dumps","createdAt":datetime.now(timezone.utc).isoformat(),"issue":486,"issueUrl":final["html_url"],"selectedArchitecture":"Unchanged revision03 five-document packet plus D188 A1/A2 selected amendments","architectureSealSha256":"1785227456c24297a90e68f96c18156e583f797d066c5363d5a8f3a3ce52728c","routingSealSha256":"b00df574b3171926a0c953f8bab8fe53f63ea30f296207ccf4864b3f92972710","decision188Sha256":sha((root/"originals"/"decision-188.md").read_bytes()),"actualFable03":v["providerTerminals"]["03"],"history":{"fable01":"Genuine exit0 REVISE PLAN at revision01; original published verbatim","fable02":v["providerTerminals"]["02"]},"allOriginalCopiesAndCurrentSourcesReverified":True,"originalMemberCount":len(v["originals"]),"originalBytes":sum(x["bytes"] for x in v["originals"]),"sourceHead":v["sourceHead"],"sourceInputsVerified":len(v["sourceChecks"]),"boundaryRows":len(v["boundaryIds"]),"comments":comments,"allCommentFreshGETBodiesExact":True,"priorIssueBodyPreservedByteForByteAsPrefix":True,"beforeBodySha256":sha(before["body"].encode("utf-8")),"finalBodySha256":sha(final["body"].encode("utf-8")),"labelsBefore":before_labels,"labelsAfter":final_labels,"onlyLabelRemoved":"needs-plan-approval","humanPlanApprovedLabelAdded":False,"roleEscalation":{"core":"gpt-6.2-astra xhigh","bounded":"gpt-6.1-sol xhigh after shared interface freeze","existingImplLabelPreserved":True},"authorization":"Root D188 under explicit owner-delegated blocker-decision authority; supersedes generic manual-plan hold for this scope, without human approval claim","remainingGates":["Actual Claude opposite-family implementation review","Independent touched-system QA","Coverage and repository checks unchanged","Current-head/current-target CI","Three-general-scan cap","Reserved fresh Astra MAX final audit","Signed merge","Owner later review/rework before owner QA"],"noSourceIndexCommitBranchOrImplementationMutation":True,"secondaryPublications":"Root separately handled D187 and #362 corrective2; no duplicate made here"}
write(root/"admission-receipt.json",r)
members=[]
for p in sorted(root.rglob("*")):
    if p.is_file() and p.name!="SHA256SUMS.json":
        b=p.read_bytes();members.append({"path":p.relative_to(root).as_posix(),"bytes":len(b),"sha256":sha(b)})
write(root/"SHA256SUMS.json",{"kind":"Local publication receipt seal; excludes this seal file only","memberCount":len(members),"totalBytes":sum(x["bytes"] for x in members),"members":members})
for x in members:
    b=(root/x["path"]).read_bytes();assert len(b)==x["bytes"] and sha(b)==x["sha256"]
print(json.dumps({"receiptSha256":sha((root/"admission-receipt.json").read_bytes()),"sealSha256":sha((root/"SHA256SUMS.json").read_bytes()),"members":len(members),"bytes":sum(x["bytes"] for x in members),"gate":"only needs-plan-approval removed; aidlc-ready retained; no plan-approved"}))

