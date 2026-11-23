from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import stat
import subprocess

packet=Path(__file__).parent
batch=packet.parent
logs=batch/'i1-ci-implementation-evidence'/'logs'
repo=Path(r'C:\Users\98jak\.codex\worktrees\gg-20261117-ci-gates\GraphGoblin')
base='6d7fcc9838d831fe1be3c3cf52c90a2f33e8f5b1'
fixture=Path(r'C:\Users\98jak\AppData\Local\Temp\gg-wp-a5b-perf-smoke-YLuv1y')

def digest(raw):
    return {'bytes':len(raw),'sha256':sha256(raw).hexdigest()}

def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()

def physical(path, directory=False):
    metadata=path.lstat()
    assert path.resolve()==path and not metadata.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
    assert (path.is_dir() if directory else path.is_file())
    return metadata

def git(*args):
    return subprocess.check_output(['git','-C',str(repo),*args])

assert git('rev-parse','HEAD').decode().strip()==base
source_paths=(
    'tooling/perf','tooling/package.json','tooling/vitest.config.mjs','tooling/vitest.shared.mjs',
    'apps/api','apps/web','packages','turbo.json','pnpm-lock.yaml','package.json','pnpm-workspace.yaml',
)
assert git('diff','--name-status',base,'--',*source_paths)==b''
assert git('ls-files','--others','--exclude-standard','--',*source_paths)==b''
base_output=physical(fixture,directory=True)
sources={}
for name in ('01-install.log','02-build-base.log','03-tooling-coverage.log','04-perf-runtime-isolated.log',
             '05-tooling-coverage-rerun.log','05-tooling-coverage-summary.json'):
    path=logs/name
    data=path.read_bytes()
    sources[name]={'original':str(path),'mtimeUtc':iso(path.stat().st_mtime),**digest(data)}
    if name.startswith(('03-','04-','05-')):
        (packet / name).write_bytes(data)
first=(packet/'03-tooling-coverage.log').read_text(encoding='utf-8')
assert str(fixture) in first and '180025ms' in first and 'PERF_CASE 1000 complete' not in first
assert 'exit=0' in (packet/'05-tooling-coverage-rerun.log').read_text(encoding='utf-8')

artifacts={}
values={}
for name in ('invocation.json','raw-summary.json','summary.json','browser.json','memory-live.jsonl'):
    path=fixture/name
    metadata=physical(path)
    data=path.read_bytes()
    artifacts[name]={'original':str(path),'mtimeUtc':iso(metadata.st_mtime),**digest(data)}
    values[name]=[json.loads(line) for line in data.splitlines()] if name.endswith('.jsonl') else json.loads(data)

summary=values['raw-summary.json']
assert summary['output']==str(fixture) and summary['environment']['commit']==base
assert summary['boot']['pid']==57048 and summary['environment']['node']=='v22.23.4'
assert summary['cases']==[] and summary['environment']['platform']=='win32'
assert not any(key in summary for key in ('error','correctnessFailure','memoryLogError','closeError','profileError'))
assert len(values['browser.json']['pages'])==3
pages=[]
for page in values['browser.json']['pages']:
    phases=[{key:page[phase][key] for key in ('status','lastEventSeq')} for phase in ('beforeRun','afterRun')]
    pages.append({'page':page['name'],'errors':len(page['errors']),'continued':page['executionContinued'],
                  'runningThroughout':page['runningThroughout'],'before':phases[0],'after':phases[1]})
rows=values['memory-live.jsonl']
assert len(rows)==650
assert len({row['runId'] for row in rows})==1 and {row['passes'] for row in rows}=={1000}
checkpoints=[]
for row in rows:
    if not checkpoints or row['lastObservedPass']!=checkpoints[-1]['pass']:
        checkpoints.append({'pass':row['lastObservedPass'],'elapsedMs':round(row['elapsedMs'],3)})
assert checkpoints[-1]['pass']==800

packages=['apps/api','packages/api-client','packages/adapter-codex','packages/adapter-jev',
          'packages/contracts','packages/domain','packages/engine','packages/infrastructure']
build=[]
for prefix in packages:
    package=repo/prefix
    metadata=package/'dist'/'.tsbuildinfo'
    data=metadata.read_bytes()
    info=json.loads(data)
    matched=[]
    differences=[]
    for filename,fileinfo in zip(info['fileNames'], info['fileInfos']):
        ref=(metadata.parent/filename).resolve()
        if not ref.is_relative_to(package/'src'):
            continue
        digest_value=fileinfo if isinstance(fileinfo,str) else fileinfo['version']
        meta={'file':ref.relative_to(repo).as_posix(),'metadataVersion':digest_value}
        if ref.is_file():
            meta['diskSha256']=sha256(ref.read_bytes()).hexdigest()
        (matched if meta.get('diskSha256')==digest_value else differences).append(meta)
    assert matched
    entry=package/'dist'/('main.js' if prefix=='apps/api' else 'index.js')
    build.append({'package':prefix,'buildInfo':{'file':str(metadata),'mtimeUtc':iso(metadata.stat().st_mtime),
        **digest(data)},'sourceMetadataMatches':len(matched),'sourceMetadataDifferences':differences,
        'compiledEntry':{'file':str(entry),'mtimeUtc':iso(entry.stat().st_mtime),**digest(entry.read_bytes())}})
bundle=repo/'apps/web/dist/assets/index-C5U89dQm.js'
sourcemap=Path(str(bundle)+'.map')
map_data=sourcemap.read_bytes()
web_data=json.loads(map_data)
mapped=[]
mismatches=[]
for filename,content in zip(web_data['sources'], web_data['sourcesContent']):
    source=(sourcemap.parent/filename).resolve()
    if not source.is_relative_to(repo/'apps/web/src') or not source.is_file() or content is None:
        continue
    expected=content.replace('\r\n','\n')
    actual=source.read_text(encoding='utf-8')
    (mapped if actual==expected else mismatches).append(source.relative_to(repo).as_posix())

result={
    'sourceHead':base,'scopedSourcePathsUnchanged':list(source_paths),
    'currentTrackedDiff':git('diff','--name-status',base).decode().splitlines(),
    'retainedLogs':sources,
    'failure':{'execTimeoutMs':180000,'testElapsedMs':180025,'exitCode':None,'signal':'SIGTERM','killed':True,
               'stageMarkerEmitted':'PERF_BROWSER complete','missingMarker':'PERF_CASE 1000 complete'},
    'fixture':{'path':str(fixture),'rootCreatedUtc':iso(base_output.st_ctime),'artifacts':artifacts,
       'initialSummaryCaseCount':len(summary['cases']),'node':summary['environment']['node'],
       'workload':summary['workload'],'sourceAtExecution':summary['environment']['commit'],'command':summary['command'],
       'browser':{'channel':values['browser.json']['channel'],'pages':pages},
       'memorySamples':len(rows),'firstElapsedMs':rows[0]['elapsedMs'],'lastElapsedMs':rows[-1]['elapsedMs'],
       'checkpoints':checkpoints,
       'maxReportedSampleGapMs':max(b['elapsedMs']-a['elapsedMs'] for a,b in zip(rows,rows[1:])),
       'missingTerminalArtifacts':[name for name in ('api.cpuprofile','profile-clock.json','memory.jsonl') if not (fixture/name).is_file()],
    },
    'currentDesktopBuildReadback':{'typescriptPackages':build,
       'webBundle':{'file':str(bundle),'mtimeUtc':iso(bundle.stat().st_mtime),**digest(bundle.read_bytes())},
       'webSourceMap':{'file':str(sourcemap),**digest(map_data),'matchedSources':len(mapped),'mismatches':mismatches},
       'qualification':'Present build files and typescript source version records are read after the attempts; the build log records cache restores and no pre-invocation artifact hash is present.'},
    'environmentQualification':'No pre-invocation NODE_OPTIONS, NODE_V8_COVERAGE or concurrent host-load receipt was found in the admitted logs. The runtime fixture follows the checked-in environment-filtering and coverage configuration.',
}
(packet/'source-and-fixture-receipts.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'checkpoints':checkpoints,'compiledSourceMatches':[(b['package'],b['sourceMetadataMatches'],len(b['sourceMetadataDifferences'])) for b in build],
                  'webMatches':len(mapped),'webMismatches':mismatches,'firstLogHash':sources['03-tooling-coverage.log']['sha256']},indent=2))
