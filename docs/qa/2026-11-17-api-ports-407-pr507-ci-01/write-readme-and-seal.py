from hashlib import sha256
from pathlib import Path
import json

root=Path(__file__).parent
d=json.loads((root/'evidence.json').read_bytes())
def mmss(seconds):
    m,s=divmod(int(seconds),60)
    return f'{m}m{s:02d}s'
def step(job,name):
    return next(s for s in d['jobs'][job]['steps'] if s['name']==name)
def jobrow(name,description):
    j=d['jobs'][name]
    return f"| [{name}]({j['url']}) | {j['conclusion'].capitalize()} | {mmss(j['durationSeconds'])} | {description} |"

cov=d['coverageArchive']
finding=d['gates']['finding']
fmtcov=f"{int(d['gates']['turboElapsedSeconds']//60)}m{d['gates']['turboElapsedSeconds']%60:.3f}s"
win=mmss(step('Windows launcher','Native Windows launcher acceptance')['durationSeconds'])
browser=mmss(step('Browser','Functional browser suite (no retries)')['durationSeconds'])
rows='\n'.join([
    jobrow('Gates','30 successful steps, actual dependency audit exit 1, one post-setup cache step skipped.'),
    jobrow('Browser',f"481 passes, one declared live-provider skip, Edge, zero retries and one worker. Functional step {browser}."),
    jobrow('Windows launcher',f"25 passes, zero skips or failures. Native step {win}."),
    jobrow('Template image','Built the image and loaded starter, implementation, review and QA templates without network or writable storage.'),
])
api_probe = next(member['apiPortModule'] for member in cov['members'] if member['package'] == 'api')
probe_sentence = f" All {d['gates']['apiPortCasesPassed']} maintained API port tests passed on the Ubuntu runner. The API port helper recorded {api_probe['lines']['pct']:.2f}% line and {api_probe['branches']['pct']:.2f}% branch coverage."
markdown=f"""# PR #507 first CI attempt

[Run {d['runId']}, number {d['runNumber']}, attempt 1]({d['runUrl']}) completed with **failure**. The required dependency audit was the sole failed step. The build, acceptance, coverage and platform evidence belongs to the original #407 candidate, and the separate #503 gate remains a blocker.

## Tested source

[Draft PR #507](https://github.com/Jacob-J-Thomas/GraphGoblin/pull/507) published head `{d['publicationHead']}` against `{d['target']}`. All four checkout logs record synthetic merge `{d['testedMerge']}`, with the target and head as ordered parents. The publication tree and the synthetic merge tree both equal `{d['testedMergeTree']}`. The base tree is `{d['targetTree']}`. [PR head](github-head-commit.json), [merge object](github-synthetic-merge.json), [checkout line bindings](evidence.json).

GitHub's complete paginated listings identified four jobs and one artifact. The four raw job logs match the connector's independently returned decoded log fingerprints. GitHub's REST jobs records provide actual step and job times and conclusions. [Terminal run metadata](github-run-attempt1.json), [job listing](github-jobs-pages.json), [artifact listing](github-artifact-pages.json), [connector readback](github-connector-readback.json).

## Results

| Job | Conclusion | Elapsed | Observed |
| --- | --- | ---: | --- |
{rows}

Gates completed all thirteen coverage groups and all 22/22 Turbo tasks. Coverage recorded **{d['gates']['passed']:,} passed and {d['gates']['skipped']:,} skipped** in {fmtcov} of Turbo elapsed time.{probe_sentence} The build, native/API acceptance, static checks, licence allowlist, generated docs and design-token contrast checks were successful. The required high-threshold dependency audit then failed with **{finding['id']}**, Picomatch `{finding['range']}`, no patched version listed, and 7 low, 13 moderate and 1 high. Its raw command-start-to-exit interval was {finding['elapsedFromRawLogSeconds']:.3f}s. [Hosted Gates log](gates.raw.log), [check annotations](github-gates-annotations-pages.json).

The Windows upload reported no matches under `.tmp/windows-launcher-*/` with hidden-file inclusion false. The complete run listing has no Windows archive. The native pass evidence is in stdout. The source of the missing archive remains a #496 concern. [Windows launcher log](windows-launcher.raw.log).

## Coverage archive

The Gates uploader and complete artifact listing agree on [artifact {cov['id']}]({cov['uri']}). The [downloaded ZIP]({cov['file']}) has {cov['bytes']:,} bytes and matches GitHub's SHA-256.

```text
{cov['sha256']}
```

All thirteen expected package summaries were read and hashed. All four required coverage floors were met by every package. Repo minima across package totals were {cov['minimum']['lines']:.2f}% lines, {cov['minimum']['branches']:.2f}% branches, {cov['minimum']['functions']:.2f}% functions and {cov['minimum']['statements']:.2f}% statements. [Per-package test denominators, file hashes and step timings](evidence.json), [manifest](manifest.json), [packet checksums](SHA256SUMS.txt).

The [separate exact-parent POSIX control](https://github.com/Jacob-J-Thomas/GraphGoblin/actions/runs/44251885185) reproduced the wildcard port grant on its hosted macOS runner. This Ubuntu/Windows CI attempt leaves that Mac defect open. A later Darwin probe candidate has its own evidence lineage.

Collected read-only with no rerun, cancellation, review, issue or source mutation.
"""
(root/'README.md').write_text(markdown,encoding='utf-8')
sources={
  'github-run.json':'GET /actions/runs/'+str(d['runId']),
  'github-run-attempt1.json':f"GET /actions/runs/{d['runId']}/attempts/1",
  'github-jobs-pages.json':f"GET /actions/runs/{d['runId']}/attempts/1/jobs?per_page=100, paginated",
  'github-artifact-pages.json':f"GET /actions/runs/{d['runId']}/artifacts?per_page=100, paginated",
  'github-pr.json':'GET /pulls/507',
  'github-gates-annotations-pages.json':'GET /check-runs/134620427512/annotations?per_page=100, paginated',
  'github-head-commit.json':'GET /git/commits/'+d['publicationHead'],
  'github-base-commit.json':'GET /git/commits/'+d['target'],
  'github-synthetic-merge.json':'GET /git/commits/'+d['testedMerge'],
  cov['file']:f"GET /actions/artifacts/{cov['id']}/zip",
  'github-connector-readback.json':'GitHub connector job-log, job-step and artifact readback',
  'evidence.json':'Derived from GitHub connector and raw GitHub REST receipts',
  'README.md':'Summary of the bound attempt',
  'verify-packet.py':'Validates raw receipts and builds evidence.json',
  'write-readme-and-seal.py':'Authors the README and seals the packet from validated evidence',
  **{j['log']['file']:f"GET /actions/jobs/{j['id']}/logs" for j in d['jobs'].values()},
}
files=sorted(f for f in root.iterdir() if f.is_file() and f.name not in ('manifest.json','SHA256SUMS.txt'))
assert {f.name for f in files}==set(sources)
items=[]
for f in files:
 data=f.read_bytes()
 items.append({'file':f.name,'source':sources[f.name],'bytes':len(data),'sha256':sha256(data).hexdigest()})
manifest={'repository':'Jacob-J-Thomas/GraphGoblin','pullRequest':507,'runId':d['runId'],'attempt':1,'sources':items}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
items.append({'file':'manifest.json','sha256':sha256((root/'manifest.json').read_bytes()).hexdigest()})
(root/'SHA256SUMS.txt').write_text(''.join(f"{r['sha256']}  {r['file']}\n" for r in items),encoding='ascii')
print(f'Sealed {len(items)} files and checksum list')
