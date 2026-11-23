import hashlib, json, os, pathlib, subprocess, sys
ROOT = pathlib.Path('G:/ggq/gg-i5-provenance-core-qa/GraphGoblin')
EVIDENCE = pathlib.Path(__file__).parent
label = sys.argv[1]
assert label in ('before', 'after-first', 'after')
destination = EVIDENCE / (label + '.state.json')
assert not destination.exists()
env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
def git(*args):
    return subprocess.check_output(['git','--no-optional-locks',*args], cwd=ROOT, env=env)
def sha(data):
    return hashlib.sha256(data).hexdigest()
def file_sha(path):
    return sha(pathlib.Path(path).read_bytes())
paths = git('ls-files','-z').decode().split('\0')[:-1]
physical, omitted = {}, []
for rel in paths:
    path = ROOT / rel
    if path.is_file():
        physical[rel] = file_sha(path)
    else:
        omitted.append(rel)
index = pathlib.Path(git('rev-parse','--path-format=absolute','--git-path','index').decode().strip())
common = pathlib.Path(git('rev-parse','--path-format=absolute','--git-common-dir').decode().strip())
overlays = ['apps/web/src/runs/inspector-read-provenance.independent.qa.test.tsx','apps/web/src/runs/inspector-provenance-cancellation.independent.qa.test.tsx','apps/web/e2e/independent-416-api-shape.qa.ts']
metadata = ['pnpm-lock.yaml','node_modules/.modules.yaml','node_modules/.pnpm/lock.yaml','node_modules/.pnpm-workspace-state-v1.json']
result = dict(head=git('rev-parse','HEAD').decode().strip(),tree=git('rev-parse','HEAD^{tree}').decode().strip(),
    indexPath=str(index),indexSha256=file_sha(index),stagedEntriesSha256=sha(git('ls-files','--stage','-z')),
    commonIndexExists=(common/'index').exists(), status=git('status','--porcelain=v1','--untracked-files=all','-z').decode().split('\0')[:-1],
    descriptorCount=len(paths),materializedTrackedCount=len(physical),materializedTracked=physical,
    omittedCount=len(omitted),omittedPathsSha256=sha('\0'.join(omitted).encode()),
    omittedOnlyDocsQa=all(p.startswith('docs/qa/') for p in omitted),
    nonQaOmissions=[p for p in omitted if not p.startswith('docs/qa/')],
    overlays={p:file_sha(ROOT/p) for p in overlays},metadata={p:file_sha(ROOT/p) for p in metadata},
    sourceLimit='Only physically materialized tracked files hashed; sparse omitted docs/qa descriptors are counted and qualified. NUL-delimited Git paths, no quoted-path decoding assumption.')
destination.write_text(json.dumps(result, indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k != 'materializedTracked'},indent=2))
