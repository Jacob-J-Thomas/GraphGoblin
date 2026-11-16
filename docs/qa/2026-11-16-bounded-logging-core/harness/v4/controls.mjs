import assert from 'node:assert/strict';

export async function privateRootReadback(native, root) {
  const reply = await native.runPowerShell('read disposable install root owner and access', String.raw`
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:QA438_FIXTURE_LOG_ROOT
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
$allowed = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) |
  Where-Object AccessControlType -eq Allow | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
[Console]::WriteLine(([ordered]@{user=$user; owner=$owner; allowed=$allowed; sddl=$acl.Sddl} | ConvertTo-Json -Compress))
`, { extraEnv: { QA438_FIXTURE_LOG_ROOT: root } });
  const observed = JSON.parse(reply.stdout);
  assert.equal(observed.owner, observed.user);
  assert.deepEqual(observed.allowed.sort(), [observed.user, 'S-1-5-18', 'S-1-5-32-544'].sort());
  assert(typeof observed.sddl === 'string' && observed.sddl.length > 0);
  return { root, ...observed };
}

export async function observeStdio(native, evidence, observer, node, { health, proc }) {
  const acquired = await native.runPowerShell('exact Win32 gateway birth for stdio observation', String.raw`
$ErrorActionPreference = 'Stop'
$owned = Get-Process -Id ([int]$env:QA438_GATEWAY_PID) -ErrorAction Stop
try {
  $birth = $owned.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)
  [Console]::WriteLine($birth)
} finally { $owned.Dispose() }
`, { extraEnv: { QA438_GATEWAY_PID: String(health.pid) } });
  const birth = acquired.stdout.trim();
  assert.match(birth, /^[1-9][0-9]{16,18}$/u);
  const diff = BigInt(birth) - BigInt(proc.creationFileTime);
  assert(diff > -10n && diff < 10n, 'Native process birth and WMI birth disagree');
  const result = await native.run('gateway NUL stdio observer', observer, [String(health.pid), birth, node],
    evidence, { input: '', timeout: 9000, reapReadOnly: true });
  assert.deepEqual([result.exit.code, result.stderr], [0, '']);
  const observation = JSON.parse(result.stdout);
  assert.deepEqual([observation.schema, observation.status, observation.pid, observation.birthFileTime],
    ['gg438-stdio-observation/v1', 'matched', health.pid, birth]);
  assert.deepEqual(observation.slots.map((slot) => slot.slot), ['stdin', 'stdout', 'stderr']);
  for (const slot of observation.slots) {
    assert.deepEqual([slot.objectName, slot.win32FileType, slot.matches], ['\\Device\\Null', 2, true]);
    assert.equal(slot[slot.slot === 'stdin' ? 'readData' : 'writeData'], true);
  }
  return { nativeBirth: birth, cimBirth: proc.creationFileTime, observation };
}

export async function privateFailure({ port, pid, request, observe, put, tail, pinoRecords, files }) {
  // Same failure boundary as the independently executed #381 a2-final-thread fixture.
  const definition = {
    schemaVersion: 4, name: 'QA 438 private engine diagnostics',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'mut', kind: 'mutate', label: 'QA mutation', config: { operations: [
        { op: 'set', path: '/vars/qaBefore', value: { kind: 'literal', value: true } },
        { op: 'set', path: '/vars', value: { kind: 'literal', value: 7 } },
      ] } },
      { id: 'done', kind: 'exit', label: 'Done',
        config: { outcome: 'success', returns: 'vars', destinations: [{ kind: 'caller' }] } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'mut' } },
      { id: 'e2', from: { node: 'mut', port: 'out' }, to: { node: 'done' } },
    ],
  };
  async function json(path, expected, options) {
    const response = await request(port, path, options);
    const raw = await response.text();
    assert.equal(response.status, expected, raw);
    return JSON.parse(raw);
  }
  const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body) });
  await put('private-failure-fixture.json', definition);
  const { loop } = await json('/loops', 201, post({ definition }));
  assert.equal((await request(port, '/loops/' + loop.id + '/publish', { method: 'POST' })).status, 200);
  const { run: { id } } = await json('/loops/' + loop.id + '/runs', 202, post({}));
  const run = await observe('private diagnostic public failure', async () => {
    const record = await json('/runs/' + id, 200);
    return record.status === 'failed' ? record : false;
  }, 12000);
  const events = await json('/runs/' + id + '/events?limit=100', 200);
  await put('private-failure-public.json', { run, events });
  assert.deepEqual(run.failure, { code: 'INTERNAL_ERROR', message: 'node mut produced an invalid patch',
    nodeId: 'mut', resumable: false });
  assert.equal(events.hasMore, false);
  const failed = events.items.find((event) => event.type === 'run.failed');
  assert.deepEqual(failed.failure, run.failure);
  const record = await observe('retained correlated private error', async () => {
    for (const path of files) {
      const entry = pinoRecords(await tail(path)).find((value) => value.runId === id &&
        value.nodeId === 'mut' && value.msg === 'node produced an invalid patch');
      if (entry) return { path, entry };
    }
    return false;
  }, 5000);
  await put('private-failure-private.json', record);
  assert.equal(record.entry.pid, pid);
  const error = record.entry.error;
  for (const key of ['name', 'message', 'stack']) assert(typeof error?.[key] === 'string' && error[key].length > 0);
  assert.doesNotMatch(JSON.stringify({ run, events }), /"stack"\s*:/u);
  assert(!JSON.stringify({ run, events }).includes(JSON.stringify(error.stack)));
}
