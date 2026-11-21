from pathlib import Path
from hashlib import sha256
import json, shutil
root=Path(r"C:\Users\98jak\graphgoblin-qa\2026-11-17-five-intents\i4-486-plan-publication-01")
items=json.loads((root/"publication-items.json").read_bytes())
checks=[]
for item in items:
    wrapped=json.loads((root/item["key"]/"readback.json").read_bytes())
    raw=json.loads(wrapped["structuredContent"]["content"])
    actual=raw["body"].encode("utf-8")
    expected=item["body"].encode("utf-8")
    source=Path(item["source"]).read_bytes()
    assert actual==expected
    assert actual[len(item["prefix"].encode("utf-8")):]==source
    assert sha256(source).hexdigest()==item["sourceSha256"]
    assert sha256(actual).hexdigest()==item["publicationBodySha256"]
    checks.append({"key":item["key"],"commentId":raw["id"],"url":raw["html_url"],"exactUtf8BodyBytes":len(actual),"bodySha256":sha256(actual).hexdigest(),"originalMemberSha256":sha256(source).hexdigest(),"fullOriginalBytesPreserved":True,"prefixBytes":len(item["prefix"].encode("utf-8"))})
(root/"comment-byte-verification.json").write_bytes((json.dumps(checks,indent=2)+"\n").encode("utf-8"))
shutil.copyfile(root.parent/"i4-486-publication-prepare.py",root/"prepare-attempt-02.py")
print(json.dumps({"allNineFreshGETBodiesByteIdentical":True,"members":len(checks)}))

