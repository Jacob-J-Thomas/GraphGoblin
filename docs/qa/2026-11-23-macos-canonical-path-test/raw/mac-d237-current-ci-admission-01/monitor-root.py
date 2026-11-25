from pathlib import Path
import subprocess,json,time,datetime,hashlib,sys
E=Path("G:/ggq/delivery-evidence/2026-11-17-five-intents")
O=E/"mac-d237-current-ci-admission-01"
a=json.loads((O/"admission.json").read_bytes())
repo="repos/Jacob-J-Thomas/GraphGoblin/"
last=None; sequence=0
while True:
 r=subprocess.run(["gh","api",repo+"actions/runs/"+str(a["run"])],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=50)
 if r.returncode:
  (O/"read-failure.stderr").write_bytes(r.stderr);raise RuntimeError("CI read failed; no automatic retry")
 run=json.loads(r.stdout)
 assert run["id"]==a["run"] and run["run_attempt"]==1 and run["head_sha"]==a["head"] and run["event"]=="pull_request"
 j=subprocess.run(["gh","api",repo+"actions/runs/"+str(a["run"])+"/attempts/1/jobs?per_page=100"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=50)
 if j.returncode:
  (O/"jobs-read-failure.stderr").write_bytes(j.stderr);raise RuntimeError("Jobs read failed; no automatic retry")
 jobs=json.loads(j.stdout)
 state={"runStatus":run["status"],"runConclusion":run["conclusion"],"jobs":[{"id":x["id"],"name":x["name"],"status":x["status"],"conclusion":x["conclusion"]} for x in jobs["jobs"]]}
 sig=json.dumps(state,sort_keys=True)
 if sig!=last:
  sequence+=1;last=sig
  (O/(f"{sequence:03d}-run.json")).write_bytes(r.stdout);(O/(f"{sequence:03d}-jobs.json")).write_bytes(j.stdout)
  print(json.dumps({"utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),**state}),flush=True)
 if run["status"]=="completed":
  if run["conclusion"]!="success":
   print("Original first attempt did not pass; no verifier acceptance or rerun.",flush=True);sys.exit(2)
  break
 time.sleep(50)
script=E/"mac-d237-ci-verifier-preparation-02/verify-mac-ci.py"
assert hashlib.sha256(script.read_bytes()).hexdigest()==a["verifierSha256"]
args=[sys.executable,"-B",str(script),"501",str(a["run"]),a["head"],a["target"],a["output"],"--workspace","G:/ggq/gg-macos-current-main/GraphGoblin","--node","C:/Users/98jak/.claude/codex-runs/GraphGoblin/runtime/node-v22.23.4-win-x64/node.exe","--windows-replay","C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents/pr508-marker-independent-qa/replay-archives.mjs"]
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (O/"verifier.stdout.json").open("xb") as out,(O/"verifier.stderr.log").open("xb") as err:
 result=subprocess.run(args,stdout=out,stderr=err)
receipt={"startedUtc":started,"finishedUtc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"args":args,"exit":result.returncode}
(O/"verifier.exit.json").write_text(json.dumps(receipt,indent=2)+"\n",encoding="utf-8")
print(json.dumps(receipt),flush=True)
sys.exit(result.returncode)
