import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const change = async (file, pairs) => {
  let bytes = await readFile(file, 'utf8');
  for (const [from, to] of pairs) {
    assert(bytes.includes(from), file + ': ' + from.slice(0, 120));
    bytes = bytes.replaceAll(from, to);
  }
  await writeFile(file, bytes);
};
await change('verify-binding.mjs', [
  ["['source', 'before', 'after']", "['offline', 'source', 'before', 'after']"],
  ["assert.equal(admission.status, 'authorized');\nassert(admission.buildGrant?.trim(), 'Requires root build authorization');", "if (mode === 'offline') assert.equal(admission.status, 'prepared');\nelse {\n  assert.equal(admission.status, 'authorized');\n  assert(admission.buildGrant?.trim(), 'Requires root build authorization');\n}"],
  ["for (const ancestor of [base, actualMain, historyParent, corrected207Integration, admission.finalParent])", "assert.equal(git('rev-parse','HEAD^2'), historyParent);\nfor (const ancestor of [base, actualMain, historyParent, corrected207Integration, admission.finalParent])"],
  ["  'editor/EditorPage.tsx',", "  'editor/EditorPage.tsx',\n  'editor/Canvas.tsx',\n  'editor/SpaceCardsOffer.tsx',\n  'editor/space-cards.ts',\n  'editor/viewport-gesture.ts',\n  'editor/route-editing.ts',\n  'editor/OrthogonalEdge.tsx',\n  'editor/canvas-focus.ts',\n  'editor/NodeCard.tsx',\n  'drafts/local-drafts.ts',"],
  ["const emit = ", "assert.equal(sourceReadback['apps/web/src/editor/space-cards.ts'], '8921ad9e67218fa788bb30e401f02702aa097932509d8413c02592d77e0fafd3');\nconst rootFreeze = JSON.parse(await readFile(join(evidence, '..','review-208-space','current-parent-freeze.json'), 'utf8'));\nif (rootFreeze.head === head) {\n  assert.equal(rootFreeze.tree,tree);\n  for (const {path, sha256} of [...rootFreeze.source, ...rootFreeze.docs]) assert.equal(sourceReadback[path],sha256,path);\n}\nconst emit = "],
  ["if (mode === 'source') {", "if (mode === 'offline') {\n  await emit('offline-source-binding.json', source);\n  console.log(JSON.stringify({ head, tree, actualMain, boundSource: files.length, runtimeStarted: false }));\n} else if (mode === 'source') {"],
  ["208-history-escalation-final-native-v1", "208-space-combined-native-v1"],
  ["  if (mode === 'after') {", "  assert.equal(report.builtFiles, 1227, 'Fresh output count changed');\n  assert.equal(Object.keys(trees).length, 13);\n  if (mode === 'after') {"],
  ["const sourceMap = {};", "const sourceMap = {};\n  assert.equal(critical[bundlePath], digest(await readFile(join(checkout,bundlePath))));\n  const entry = await readFile(join(checkout, bundlePath), 'utf8');\n  assert(entry.includes('sourceMappingURL=' + bundlePath.split('/').at(-1) + '.map'));"],
]);
await change('build-frozen.ps1', [
  ["$env:TURBO_TEAM = ''", "$env:TURBO_TEAM = ''\n$env:TURBO_CACHE = 'local:rw'"],
  ["$cache = Join-Path $packet 'isolated-turbo-cache'", "$cache = Join-Path $packet 'isolated-turbo-cache'\n  if (Test-Path -LiteralPath $cache) { throw 'A fresh cache is required' }"],
  ["    cleanAfter = $clean;", "    cache = $cache; cleanAfter = $clean;"],
]);
await change('drivers/gateway.mjs', [
  ["'208-history-escalation-final-native-v1'", "'208-space-combined-native-v1'"],
  ["const sourceFields = Object.keys(bound.sourceReadback);", "const sourceFields = Object.keys(bound.mapping.sourceHashes);"],
  ["assert.deepEqual(sourceHashes,bound.sourceReadback);", "assert.deepEqual(sourceHashes,bound.mapping.sourceHashes);"],
  ["buildHashes, served, apiEntryHash", "buildHashes, served, apiEntryHash"],
  ["  const served = {};", "  async function servedReadback() {\n  const hashes = {};"],
  ["    served[file] = actual;\n  }", "    hashes[file] = actual;\n  }\n  return hashes;\n  }\n  const served = await servedReadback();"],
  ["    process.stdin.resume();\n  });", "    process.stdin.resume();\n  });\n  const servedAfter = await servedReadback();\n  assert.deepEqual(servedAfter,served);\n  await writeFile(join(evidence,'served-after.json'),JSON.stringify(servedAfter,null,2)+'\\n',{flag:'wx'});"],
]);
await change('drivers/run-case.mjs', [
  ["const matrix = {\n  'h-d1': 'd1-fine-light', 'h-d2': 'd2-coarse-dark', 'h-n768': 'n768-fine-light', 'h-r512': 'r512-reflow200',\n  offline: 'n768-fine-light', unreachable: 'd1-fine-light', 'put-flash': 'd2-coarse-dark', http500: 'r512-reflow200',\n  'ownership-d1': 'd1-fine-light', 'ownership-r512': 'r512-reflow200', n360: 'n360-fine-light',\n};", "const matrix = {\n  'apply-d1': 'd1-fine-light', 'gestures-d1': 'd1-fine-light', 'n768': 'n768-fine-light',\n  'touch-d2': 'd2-coarse-dark', 'double-r512': 'r512-reflow200', 'device-d1': 'd1-fine-light',\n};"],
  ["driver-v2-manifest.json", "driver-manifest.json"],
  ["assert(['h-d1','h-d2','h-n768','h-r512','ownership-d1','ownership-r512'].includes(group), 'Only remaining matrix is admitted');\n", ""],
  ["history.playwright.js", "space.playwright.js"],
  ["208-history-escalation-final-native-v1", "208-space-combined-native-v1"],
  ["join(base, '..', 'fixture-corrections.json')", "join(base, 'fixture-corrections.json')"],
  ["execFileSync(process.execPath, [join(here, 'verify-reuse.mjs'), resolve(admissionFile),\n  join(output, 'binding-readonly-before.json'), join(base, 'binding', 'read-only-before.json')],\n  {cwd:output,windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:128*1024*1024});", "const options={cwd:worktree,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'},maxBuffer:128*1024*1024};\nconst readIdentity=()=>execFileSync('git',['rev-parse','HEAD','HEAD^{tree}','origin/main'],options).trim().split(/\\r?\\n/);\nassert.deepEqual(readIdentity(),[admission.head,admission.tree,admission.actualMain]);\nassert.equal(execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],options).trim(),'');"],
  ["await copyFile(join(here, driverName), join(output, driverName));", "await copyFile(join(here, driverName), join(output, driverName));\nawait copyFile(join(base, 'driver-manifest.json'), join(output,'driver-manifest.json'));\nawait copyFile(resolve(admissionFile), join(output,'admission.json'));\nfor (const name of ['run-case.mjs','verify-cleanup.ps1']) await copyFile(join(here,name),join(output,name));"],
  ["gg208e-", "gg208space-"],
  ["const scratch = resolve(closed.scratch);\n    assert(scratch.startsWith(output + '\\\\') || scratch.startsWith(output + '/'), 'scratch escaped run dir');", "const scratch = await realpath(closed.scratch);\n    assert.equal(dirname(scratch).toLowerCase(), (await realpath(output)).toLowerCase(), 'scratch escaped run dir');\n    assert(/^gateway-store-[a-z0-9]+$/i.test(scratch.split(/[\\\\/]/).at(-1)), 'unexpected scratch basename');"],
  ["readFile, readdir, rm,", "readFile, readdir, realpath, rm,"],
  ["!info.store?.removed || info.store.residualLockWalShm.length", "!info.store?.removed || !info.store.sqliteFilePresent || info.store.residualLockWalShm.length"],
]);
await change('drivers/verify-cleanup.ps1', [
  ["gg208e-", "gg208space-"],
  ["  $sameBinding = ", "  $servedAfter = Get-Content -Raw -LiteralPath (Join-Path $fixture 'served-after.json') | ConvertFrom-Json\n  $sameServing = ($servedAfter | ConvertTo-Json -Compress) -eq ($opened.served | ConvertTo-Json -Compress)\n  $sameBinding = "],
  ["$clean = $sameBinding -and", "$clean = $sameBinding -and $sameServing -and $run.store.sqliteFilePresent -and"],
]);

