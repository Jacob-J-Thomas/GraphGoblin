from pathlib import Path
import subprocess, os, sys, json, hashlib, datetime, shutil
base=Path(r"G:\ggq\delivery-evidence\2026-11-17-five-intents\i4-486-supplemental-independent-01")
scratch=Path(r"G:\ggq\qa-scratch\i4-486-supplemental-independent-01")
group=sys.argv[1];attempt=int(sys.argv[2]) if len(sys.argv)>2 else 1
out=base/"results"/group/f"attempt-{attempt}";out.mkdir(parents=True,exist_ok=False)
work=scratch/group/f"attempt-{attempt}";work.mkdir(parents=True,exist_ok=False);(work/"tmp").mkdir()
rt=Path(r"C:\Users\98jak\.claude\codex-runs\GraphGoblin\runtime\node-v22.23.4-win-x64")
env={k:v for k,v in os.environ.items() if not k.upper().startswith(("GG_","JEV_"))};env.update({"PATH":str(rt)+os.pathsep+env["PATH"],"TEMP":str(work/"tmp"),"TMP":str(work/"tmp"),"QA_ATTEMPT":str(attempt),"QA_WORK":str(work),"NO_COLOR":"1"})
args=[str(rt/"node.exe"),str(base/"drivers"/(group+".mjs"))]
files=[]
(out/"input-copy").mkdir()
for x in sorted((base/"drivers").glob("*.mjs")):
 b=x.read_bytes();shutil.copyfile(x,out/"input-copy"/x.name);files.append({"path":str(x),"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()})
(out/"driver-inputs.json").write_text(json.dumps(files,indent=2)+"\n")
meta={"command":args,"cwd":str(work),"startedUTC":datetime.datetime.now(datetime.timezone.utc).isoformat(),"envOverrides":{k:env[k] for k in ["TEMP","TMP","QA_ATTEMPT","QA_WORK"]},"driverSource":"4d982162ca60e885d5af22f66076383a048215db"}
try:
 result=subprocess.run(args,cwd=work,env=env,capture_output=True,timeout=75);meta["exitCode"]=result.returncode;(out/"stdout.txt").write_bytes(result.stdout);(out/"stderr.txt").write_bytes(result.stderr)
except subprocess.TimeoutExpired as error:
 meta["exitCode"]="OWNED_DRIVER_TIMEOUT";(out/"stdout.txt").write_bytes(error.stdout or b"");(out/"stderr.txt").write_bytes(error.stderr or b"")
meta["finishedUTC"]=datetime.datetime.now(datetime.timezone.utc).isoformat();(out/"execution.json").write_text(json.dumps(meta,indent=2)+"\n");print(json.dumps(meta));print((out/"stdout.txt").read_text());print((out/"stderr.txt").read_text()[-4000:])
