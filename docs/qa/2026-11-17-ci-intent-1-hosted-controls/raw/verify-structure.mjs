import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packet = dirname(fileURLToPath(import.meta.url));
const repo = process.cwd();
const yamlInstall = join(repo, 'node_modules/.pnpm/yaml@2.9.1/node_modules/yaml');
const yaml = createRequire(import.meta.url)(join(yamlInstall, 'dist/index.js'));
const manifest = JSON.parse(readFileSync(join(packet, 'publication-manifest.json'), 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const jsonSha = (value) => sha(JSON.stringify(value));
const parse = (raw) => yaml.parse(raw.toString('utf8'), { version: '1.2', uniqueKeys: true });
const expression = (value) => '$' + '{{ ' + value + ' }}';
const candidateFile = readFileSync(resolve(repo, manifest.candidateWorkflow.targetPath));
assert.equal(sha(candidateFile), manifest.candidateWorkflow.sha256);
const candidate = parse(candidateFile);
for (const seal of manifest.sourceSeals) {
  assert.equal(sha(readFileSync(seal.sourcePath)), seal.sha256, seal.sourcePath);
}
const candidateData = {};
const results = [];

function walkScripts(value, path = []) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const next = [...path, key];
    if (key === 'run') {
      assert.equal(typeof item, 'string');
      return [{ path: next.join('.'), bytes: Buffer.byteLength(item), sha256: sha(item) }];
    }
    return walkScripts(item, next);
  });
}

for (const record of manifest.entries) {
  const old = readFileSync(join(packet, record.beforePath));
  const updated = readFileSync(join(packet, record.path));
  assert.deepEqual(old, readFileSync(record.sourcePath), record.sourcePath);
  assert.equal(sha(old), record.beforeSha256);
  if (record.sha256) assert.equal(sha(updated), record.sha256);
  const result = {
    path: record.path,
    beforeSha256: sha(old),
    afterSha256: sha(updated),
    byteChanged: !old.equals(updated),
  };
  if (record.targetPath.endsWith('.yml')) {
    const before = parse(old);
    const after = parse(updated);
    assert.deepStrictEqual(after, before, record.targetPath);
    result.parsedYamlSha256Before = jsonSha(before);
    result.parsedYamlSha256After = jsonSha(after);
    assert.equal(result.parsedYamlSha256Before, result.parsedYamlSha256After);
    result.exactYamlObjectMatch = true;
    const scripts = walkScripts(after);
    assert.deepStrictEqual(scripts, walkScripts(before));
    result.exactRunScripts = scripts;
    const key = record.targetPath.split('/').at(-1).replace(/\.yml$/, '');
    assert.deepStrictEqual(after.on, {
      push: { branches: ['codex/qa/gg-' + key.slice(3)] },
    });
    result.branch = after.on.push.branches[0];
    candidateData[key] = after;
  } else {
    assert.ok(old.equals(updated), record.targetPath);
  }
  results.push(result);
}

const ci = candidate.jobs;
const matched = {};
const ciGates = ci.gates;
const laneNames = ['repository-checks', 'coverage', 'gates'];
const coverageCommand = 'pnpm exec turbo run test:coverage --concurrency=1';
const injectedCoverage = "mkdir -p packages/contracts/coverage && printf '{\"total\":{\"lines\":{\"pct\":0}},\"qa\":\"benign partial report\"}' > packages/contracts/coverage/coverage-summary.json\n";
for (const kind of ['coverage-fails-early', 'coverage-step-timeout', 'static-fails', 'external-cancel']) {
  const name = 'qa-488-' + kind;
  const final = candidateData[name];
  assert.deepStrictEqual(Object.keys(final.jobs), laneNames);
  const normalized = structuredClone(final.jobs);
  const coverage = normalized.coverage.steps;
  const staticSteps = normalized['repository-checks'].steps;
  let injection;
  if (kind === 'external-cancel') {
    const expected = {
      name: 'QA cancellation window',
      id: 'qa_cancel_window',
      shell: 'bash',
      'timeout-minutes': 4,
      run: "printf '%s\\n' 'QA488_CANCEL_WINDOW active'\nsleep 180\n",
    };
    assert.deepStrictEqual(coverage.shift(), expected);
    assert.deepStrictEqual(staticSteps.shift(), expected);
    injection = 'First step in each lane waits three minutes with a four-minute step timeout.';
  } else if (kind === 'static-fails') {
    const idx = staticSteps.findIndex((step) => step.name === 'QA injected static failure');
    assert.ok(idx >= 0 && staticSteps[idx + 1].name === 'Reset acceptance');
    assert.deepStrictEqual(staticSteps.splice(idx, 1), [{ name: 'QA injected static failure', run: 'exit 1' }]);
    injection = 'One failing step before Reset acceptance.';
  } else {
    const step = coverage.find((item) => item.name === 'Unit tests with coverage thresholds');
    assert.ok(step);
    if (kind === 'coverage-step-timeout') {
      assert.equal(step['timeout-minutes'], 1);
      step['timeout-minutes'] = 25;
      assert.equal(step.run, injectedCoverage + 'sleep 180\n');
      injection = 'The coverage step writes a benign partial report, sleeps for three minutes and times out at one minute.';
    } else {
      assert.equal(step.run, injectedCoverage + "echo 'QA injected coverage failure'\nexit 1\n");
      injection = 'The coverage step writes a benign partial report and exits 1.';
    }
    step.run = coverageCommand;
  }
  const source = Object.fromEntries(laneNames.map((key) => [key, ci[key]]));
  assert.deepStrictEqual(normalized, source, name);
  matched[name] = { exactGatesObject: true, exactCandidateJobsAfterRemovingDocumentedInjection: laneNames, injection };
}

const fanin = candidateData['qa-488-fanin'];
const faninNeeds = {
  'gates-success-success': ['stub-success-a', 'stub-success-b'],
  'gates-success-failure': ['stub-success-a', 'stub-failure'],
  'gates-skipped-success': ['stub-skipped', 'stub-success-b'],
  'gates-success-cancelled': ['stub-success-a', 'stub-cancelled'],
};
for (const [name, needs] of Object.entries(faninNeeds)) {
  const expected = structuredClone(ciGates);
  expected.name = name;
  expected.needs = needs;
  expected.steps[0].env = {
    REPOSITORY_CHECKS: expression('needs.' + needs[0] + '.result'),
    COVERAGE: expression('needs.' + needs[1] + '.result'),
  };
  assert.deepStrictEqual(fanin.jobs[name], expected);
}
matched['qa-488-fanin'] = { exactCandidateGatesJobsAfterRemappingNamesAndNeeds: faninNeeds };

const negativeFile = 'windows-launcher.qa-negative.acceptance.mjs';
const runAttempt = expression('github.run_attempt');
const negCanary = 'QA496-' + expression('github.run_id') + '-' + runAttempt;
const candidateUploadName = 'windows-launcher-' + runAttempt;

function assertWindowsCandidate(workflowKey, jobName, kind) {
  const workflow = candidateData[workflowKey];
  const job = structuredClone(workflow.jobs[jobName]);
  const expectedCandidate = ci['windows-launcher'];
  job.name = expectedCandidate.name;
  const observe = job.steps.pop();
  assert.equal(observe.name, 'QA readback (prints facts, never fails)');
  assert.equal(observe.if, 'always()');
  assert.equal(observe.env.ARTIFACT_ID, expression('steps.upload.outputs.artifact-id'));
  const upload = job.steps.at(-1);
  assert.equal(upload.id, 'upload');
  delete upload.id;
  const init = job.steps.find((step) => step.id === 'evidence');
  if (kind === 'invalid-prepare') {
    assert.ok(!Object.hasOwn(init.env, 'RUNNER_TEMP'));
    assert.equal(init.run, '$env:RUNNER_TEMP = $env:GITHUB_WORKSPACE\nnode tooling/scripts/windows-launcher-evidence.mjs init\nexit $LASTEXITCODE\n');
    init.run = 'node tooling/scripts/windows-launcher-evidence.mjs init';
  } else if (kind === 'install-fails') {
    const install = job.steps.find((step) => step.id === 'install');
    assert.equal(install.run, 'exit 1');
    install.run = 'pnpm install --frozen-lockfile';
    assert.equal(upload.with.name, 'qa496-not-run-' + candidateUploadName);
    upload.with.name = candidateUploadName;
  } else {
    const native = job.steps.find((step) => step.id === 'native');
    assert.equal(native.name, 'QA negative native acceptance');
    assert.equal(native.run, 'node --test tooling/scripts/' + negativeFile);
    native.name = 'Native Windows launcher acceptance';
    native.run = 'pnpm test:windows-launcher';
    const canaries = {
      QA_496_CANARY: negCanary,
      GG_QA_496_ENV_CANARY: negCanary + '-ENV',
      QA_496_PLAIN_ENV_CANARY: negCanary + '-PLAINENV',
    };
    for (const [key, value] of Object.entries(canaries)) {
      assert.equal(native.env[key], value);
      delete native.env[key];
    }
    assert.equal(upload.with.name, 'qa496-negative-' + candidateUploadName);
    upload.with.name = candidateUploadName;
    assert.equal(upload.with['retention-days'], 7);
    delete upload.with['retention-days'];
  }
  assert.deepStrictEqual(job, expectedCandidate, jobName);
}

assertWindowsCandidate('qa-496-invalid-prepare', 'windows-launcher-invalid-prepare', 'invalid-prepare');
assertWindowsCandidate('qa-496-invalid-prepare', 'windows-launcher-install-fails', 'install-fails');
assertWindowsCandidate('qa-496-candidate-negative', 'windows-launcher-negative', 'negative');
const refusal = candidateData['qa-496-candidate-negative'].jobs['evidence-refusal'];
const originalRefusalPath = resolve(packet, '../i1-ci-correction-independent-qa/hosted-original/qa-496-candidate-negative.yml');
const originalRefusal = parse(readFileSync(originalRefusalPath)).jobs['evidence-refusal'];
const correctedRefusal = structuredClone(originalRefusal);
const originalInit = '  node tooling/scripts/windows-launcher-evidence.mjs init\n  if ($LASTEXITCODE -ne 0) { throw "init failed for $case" }\n';
const correctedInit = '  node tooling/scripts/windows-launcher-evidence.mjs init | Out-Host\n  $initCode = $LASTEXITCODE\n  if ($initCode -ne 0) { throw "init failed for $case" }\n';
assert.equal(correctedRefusal.steps[2].run.split(originalInit).length, 2);
correctedRefusal.steps[2].run = correctedRefusal.steps[2].run.replace(originalInit, correctedInit);
assert.deepStrictEqual(refusal, correctedRefusal);
matched['qa-496-invalid-prepare'] = {
  exactWindowsCandidateJobsAfterRemovingHarnessDifferences: ['windows-launcher-invalid-prepare', 'windows-launcher-install-fails'],
};
matched['qa-496-candidate-negative'] = {
  exactWindowsCandidateJobsAfterRemovingHarnessDifferences: ['windows-launcher-negative'],
  exactOriginalRefusalJobWithPreviouslySealedIndependentQAPowerShellCorrection: true,
};

console.log(JSON.stringify({
  node: process.version,
  yaml: { version: '2.9.1', schema: 'YAML 1.2 core', uniqueKeys: true },
  exitCode: 0,
  candidateWorkflow: manifest.candidateWorkflow,
  gatesObjectSha256: jsonSha(ciGates),
  gatesRunScriptSha256: sha(ciGates.steps[0].run),
  candidateCorrespondence: matched,
  results,
}, null, 2));
