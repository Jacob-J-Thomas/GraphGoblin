from pathlib import Path
from hashlib import sha256
import json, shutil, subprocess, importlib.util, re
q=Path(r"C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents")
out=q/"i4-486-plan-publication-01"
if out.exists(): raise RuntimeError("New publication directory already exists; inspect before continuing")
out.mkdir()
def digest(p): return sha256(p.read_bytes()).hexdigest()
def dump(p,obj): p.write_bytes((json.dumps(obj,ensure_ascii=False,indent=2)+"\n").encode("utf-8"))
def seal_verify(folder):
    results=[]
    for line in (folder/"SHA256SUMS").read_bytes().decode("utf-8").splitlines():
        h,rel=line.split("  ",1)
        assert digest(folder/rel)==h,(folder,rel)
        results.append({"path":str(folder/rel),"bytes":(folder/rel).stat().st_size,"sha256":h})
    return results
architecture=q/"i4-486-architecture-03"
routing=q/"i4-486-implementation-routing-01"
assert digest(architecture/"SHA256SUMS")=="1785227456c24297a90e68f96c18156e583f797d066c5363d5a8f3a3ce52728c"
assert digest(routing/"SHA256SUMS")=="b00df574b3171926a0c953f8bab8fe53f63ea30f296207ccf4864b3f92972710"
seals={"architecture":seal_verify(architecture),"routing":seal_verify(routing)}
manifest=json.loads((architecture/"manifest.json").read_bytes())
for item in manifest["documents"]: assert digest(architecture/item["path"])==item["sha256"]
for item in manifest["inputs"]: assert digest(q/item["path"])==item["sha256"],item
checkout=Path(manifest["source"]["checkout"])
head=subprocess.check_output(["git","rev-parse","HEAD"],cwd=checkout,text=True).strip()
assert head==manifest["source"]["head"]
source_checks=[]
for item in manifest["source"]["inputs"]:
    actual=digest(checkout/item["path"])
    assert actual==item["sha256"],item
    source_checks.append({**item,"verified":True})
boundary_ids=re.findall(r"^\\| (B[0-9]{2})", (architecture/"boundaries.md").read_bytes().decode("utf-8"),re.M)
# Exact row accounting, independently from prose mentions.
boundary_ids=[line.split(" · ",1)[0][2:] for line in (architecture/"boundaries.md").read_bytes().decode("utf-8").splitlines() if re.match(r"^\\| B[0-9]{2} ·",line)]
assert boundary_ids==[f"B{i:02d}" for i in range(1,27)],boundary_ids
spec=importlib.util.spec_from_file_location("provider_terminal",q/"inspect-provider-terminal.py")
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
providers={}
for n in ["01","03"]:
    base=q/f"i4-486-fable-plan-critique-{n}"
    terminal=module.terminal(base/"provider")
    report=Path(terminal["report"]).read_bytes()
    result=json.loads((base/"provider"/"result.json").read_bytes())
    assert report==result["result"].encode("utf-8")
    s=json.loads((base/"spec.json").read_bytes())
    assert s["readOnly"] is True and s["model"]=="claude-fable-5-2" and s["effort"]=="xhigh"
    providers[n]={"terminal":terminal,"spec":s,"exit":json.loads((base/"provider"/"exit.json").read_bytes()),"reportBytes":len(report),"resultIsError":result["is_error"],"resultSubtype":result["subtype"]}
assert providers["03"]["terminal"]["reportSha256"]=="8a1c4fb12687d395daedfa59a099fe1779e93b6c675b2239cc0f6f035fc5243f"
base02=q/"i4-486-fable-plan-critique-02"/"provider"
result02=json.loads((base02/"result.json").read_bytes())
assert result02["is_error"] is True and "session limit" in result02["result"]
assert (base02/"provider-final-message.md").read_bytes()==result02["result"].encode("utf-8")
assert json.loads((base02/"exit.json").read_bytes())["code"]==1
providers["02"]={"status":"quota-ended; no review verdict","exit":json.loads((base02/"exit.json").read_bytes()),"resultSubtype":result02["subtype"],"resultIsError":result02["is_error"],"retainedText":result02["result"],"reportSha256":digest(base02/"provider-final-message.md")}
selected=[architecture,routing]+[q/f"i4-486-fable-plan-critique-{n}" for n in ["01","02","03"]]
originals=[]
for folder in selected:
    for src in sorted(folder.rglob("*")):
        if not src.is_file(): continue
        dst=out/"originals"/src.relative_to(q);dst.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(src,dst)
        assert dst.read_bytes()==src.read_bytes()
        originals.append({"source":str(src),"copy":dst.relative_to(out).as_posix(),"bytes":src.stat().st_size,"sha256":digest(src)})
d188=q/"decision-188.md";dst=out/"originals"/d188.name;shutil.copyfile(d188,dst)
originals.append({"source":str(d188),"copy":dst.relative_to(out).as_posix(),"bytes":d188.stat().st_size,"sha256":digest(d188)})
items=[]
for i,name in enumerate(["README.md","boundaries.md","expression-provenance.md","verification.md","critique-disposition.md"],1):
    src=architecture/name
    prefix=f"# #486 written plan — revision 03 · {i}/5 · {name}\n\n"
    items.append({"key":f"plan-{i}","title":f"Revision03 {name}","source":str(src),"prefix":prefix,"sourceSha256":digest(src),"body":prefix+src.read_bytes().decode("utf-8"),"kind":"Immutable written plan member; editorial title prepended without changing member bytes"})
for key,title,src in [
 ("fable03","Actual Fable03 ACCEPT REVISED PLAN",q/"i4-486-fable-plan-critique-03"/"provider"/"provider-final-message.md"),
 ("selection","D188 delegated selection and A1/A2",d188),
 ("fable01","Historical Fable01 REVISE PLAN",q/"i4-486-fable-plan-critique-01"/"provider"/"provider-final-message.md")
]:
    items.append({"key":key,"title":title,"source":str(src),"prefix":"","sourceSha256":digest(src),"body":src.read_bytes().decode("utf-8"),"kind":"Full original bytes verbatim"})
history="# #486 planning history — quota-ended attempt 02\n\nActual Fable attempt 02 ended with provider exit 1 and result is_error=true. It issued no planning verdict. Its original final message is retained below unchanged; this is not a successful review. Historical attempt 01 returned REVISE PLAN on revision 01. Actual attempt 03 returned ACCEPT REVISED PLAN on revision 03, and D188 separately selects A1/A2.\n\n"
src=base02/"provider-final-message.md"
items.append({"key":"fable02-history","title":"Fable02 quota history; no verdict","source":str(src),"prefix":history,"sourceSha256":digest(src),"body":history+src.read_bytes().decode("utf-8"),"kind":"New historical context plus unchanged original quota message"})
for item in items:
    assert len(item["body"])<60000
    assert item["body"][len(item["prefix"]):].encode("utf-8")==Path(item["source"]).read_bytes()
    item["publicationBodySha256"]=sha256(item["body"].encode("utf-8")).hexdigest()
    item["publicationBodyBytes"]=len(item["body"].encode("utf-8"))
dump(out/"validation.json",{"providerTerminals":providers,"seals":seals,"sourceHead":head,"sourceChecks":source_checks,"manifestInputHashesVerified":len(manifest["inputs"]),"boundaryIds":boundary_ids,"originals":originals,"limits":"Administrative byte/source binding and provider-result validation only; no implementation or plan re-review"})
dump(out/"publication-items.json",items)
print(json.dumps({"directory":str(out),"items":[{k:item[k] for k in ["key","sourceSha256","publicationBodyBytes"]} for item in items],"provider03":providers["03"]["terminal"],"originalCount":len(originals),"originalBytes":sum(x["bytes"] for x in originals)}))

