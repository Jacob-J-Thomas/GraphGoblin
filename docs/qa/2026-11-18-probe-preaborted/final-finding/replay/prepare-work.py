import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
from datetime import datetime, timezone

OUT = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(os.environ['GG505_VERIFIED_CHECKOUT']).resolve()
WORK = OUT.parent / 'pr505-final-disposable-work-01'
HEAD = '0ff00d6717bfb397e42bf85db8fe62ed1fc0d9b7'
TEST = 'packages/adapter-codex/src/probe-directory.test.ts'
if WORK.exists():
    raise RuntimeError('Fresh external work directory required')
WORK.mkdir()
raw = subprocess.Popen(['git','-C',str(SRC),'archive','--format=tar',HEAD], stdout=subprocess.PIPE)
count = size = 0
with tarfile.open(fileobj=raw.stdout, mode='r|*') as tar:
    for m in tar:
        if m.isdir():
            continue
        if not m.isfile() or m.name.startswith(('/',chr(92))) or '..' in pathlib.PurePosixPath(m.name).parts:
            raise ValueError(m.name)
        p=WORK / m.name
        p.parent.mkdir(parents=True,exist_ok=True)
        with tar.extractfile(m) as s, p.open('xb') as f:
            shutil.copyfileobj(s,f)
        count+=1
        size+=m.size
if raw.wait()!=0:
    raise RuntimeError('git archive')
expected = subprocess.check_output(['git','-C',str(SRC),'show',f'{HEAD}:{TEST}'])
assert (WORK/TEST).read_bytes()==expected
print(json.dumps({'head':HEAD,'tree':subprocess.check_output(['git','-C',str(SRC),'rev-parse',HEAD+'^{tree}'],text=True).strip(),'files':count,'bytes':size,'testSha256':hashlib.sha256(expected).hexdigest(),'exportFinished':datetime.now(timezone.utc).isoformat(),'method':'git archive of exact committed tree, private disposable copy with local dependency installation'}))
