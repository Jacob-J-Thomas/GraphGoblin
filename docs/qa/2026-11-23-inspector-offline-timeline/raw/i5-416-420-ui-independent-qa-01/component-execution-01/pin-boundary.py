import hashlib,json,os,pathlib,subprocess,sys
root=pathlib.Path('G:/ggq/gg-i5-offline-ui-qa/GraphGoblin'); evidence=pathlib.Path(__file__).parent
label=sys.argv[1];assert label in ('before','after')
def git(*args):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=root,env=dict(os.environ,GIT_OPTIONAL_LOCKS='0'))
def sha(data):return hashlib.sha256(data).hexdigest()
def file_sha(path):return sha(path.read_bytes())
paths=git('ls-files','-z').decode().split('\0')[:-1]
dependencies=[p for p in paths if not p.startswith('docs/qa/') and (p=='package.json' or p.endswith('/package.json') or p in ('pnpm-lock.yaml','pnpm-workspace.yaml','.nvmrc','.npmrc'))]
metadata=['node_modules/.modules.yaml','node_modules/.pnpm/lock.yaml','node_modules/.pnpm-workspace-state-v1.json']
sources=['apps/web/src/runs/RunInspectorPage.tsx','apps/web/src/runs/inspector-read-provenance.ts','apps/web/src/api/queries.ts','apps/web/src/runs/inspector/Timeline.tsx','apps/web/src/runs/inspector/RunControls.tsx','apps/web/src/runs/inspector/WaitPanel.tsx','apps/web/src/runs/inspector/ScriptRecovery.tsx','apps/web/src/runs/inspector/SessionRecoveryControls.tsx','apps/web/src/runs/HistoryEligibility.tsx','apps/web/e2e/server.ts','apps/api/src/testing/test-app.ts','apps/web/e2e/global-setup.ts','apps/web/e2e/fixtures.ts','apps/web/playwright.config.ts','apps/web/e2e/bounded-history.spec.ts','apps/web/e2e/inspector-availability.spec.ts']
index=pathlib.Path(git('rev-parse','--path-format=absolute','--git-path','index').decode().strip());common=pathlib.Path(git('rev-parse','--path-format=absolute','--git-common-dir').decode().strip())
overlays=['apps/web/src/runs/RunInspectorPage.independent-416.qa.test.tsx','apps/web/e2e/independent-416-420-helpers.ts','apps/web/e2e/independent-420-geometry.ts','apps/web/e2e/independent-416-listener.qa.spec.ts','apps/web/e2e/independent-420-geometry.qa.spec.ts']
result=dict(head=git('rev-parse','HEAD').decode().strip(),tree=git('rev-parse','HEAD^{tree}').decode().strip(),indexSha256=file_sha(index),stagedEntriesSha256=sha(git('ls-files','--stage','-z')),commonIndexExists=(common/'index').exists(),status=git('status','--porcelain=v1','--untracked-files=all','-z').decode().split('\0')[:-1],dependencyInputs={p:file_sha(root/p) for p in dependencies},metadata={p:file_sha(root/p) for p in metadata},selectedSources={p:file_sha(root/p) for p in sources},overlays={p:file_sha(root/p) for p in overlays},scope='Preparation pins only; selected source/dependency boundaries, not full-source/install identity or product execution.')
destination=evidence/(label+'.json');assert not destination.exists();destination.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ('dependencyInputs','selectedSources','metadata')},indent=2))
