import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { Agent, createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const [, , swiftPathArgument, archiveArgument] = process.argv
assert.ok(swiftPathArgument && archiveArgument)
assert.equal(process.version, 'v22.23.4')
const swiftPath = resolve(swiftPathArgument)
const archive = resolve(archiveArgument)
const token = 'fixture-control-check'
const replacement = '\\#(token)'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

const swift = readFileSync(swiftPath)
const match = /let main = #"""\r?\n([\s\S]*?)\r?\n +"""#/.exec(swift.toString('utf8'))
assert.ok(match, 'Installed engine test must have the cold helper program')
const raw = match[1]
assert.equal(raw.split(replacement).length, 2, 'One Swift token substitution is expected')
const program = raw.replace(replacement, token)
assert.ok(program.includes("connection: 'close'"))
writeFileSync(join(archive, 'embedded-fixture.mjs'), program, { flag: 'wx', mode: 0o600 })

const scratch = mkdtempSync(join(tmpdir(), 'gg-node-fixture-probe-'))
const reservation = createServer()
reservation.listen(0, '127.0.0.1')
await once(reservation, 'listening')
const port = reservation.address().port
assert.ok(![4747, 4748].includes(port))
await new Promise(resolveClose => reservation.close(resolveClose))

const child = spawn(process.execPath, ['--input-type=module', '-e', program], {
  cwd: scratch,
  env: { ...process.env, GG_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
})
const death = once(child, 'close')
const childStreams = { stdout: { bytes: 0, eof: false }, stderr: { bytes: 0, eof: false } }
for (const stream of ['stdout', 'stderr']) {
  child[stream].on('data', bytes => { childStreams[stream].bytes += bytes.length })
  child[stream].once('end', () => { childStreams[stream].eof = true })
}
const agent = new Agent({ keepAlive: true, maxSockets: 1 })

function call(path, method = 'GET', headers = {}) {
  return new Promise((resolveResponse, reject) => {
    const work = request({
      host: '127.0.0.1', port, path, method, headers, agent, signal: AbortSignal.timeout(1500)
    }, response => {
      const parts = []
      response.on('data', part => parts.push(part))
      response.once('error', reject)
      response.once('end', () => resolveResponse({
        status: response.statusCode,
        body: Buffer.concat(parts).toString(),
        connection: response.headers.connection,
        fingerprint: response.headers['x-graphgoblin-instance'],
        pid: response.headers['x-graphgoblin-pid'],
        phase: response.headers['x-graphgoblin-phase']
      }))
    })
    work.once('error', reject)
    work.end()
  })
}

try {
  let health
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      health = await call('/healthz')
      break
    } catch (error) {
      if (error.code !== 'ECONNREFUSED') throw error
      await pause(20)
    }
  }
  assert.equal(health?.status, 200)
  assert.equal(health.body, '{"status":"ok"}')
  assert.equal(health.pid, String(child.pid))
  assert.equal(health.fingerprint, 'a'.repeat(64))
  assert.equal(health.phase, 'running')
  const app = await call('/app/')
  assert.equal(app.status, 200)
  assert.equal(app.body, '<html>management</html>')
  const goblin = await call('/goblin/')
  assert.equal(goblin.status, 200)
  assert.equal(goblin.body, '<html>Goblin</html>')
  const wrongToken = await call('/fixture-drain', 'POST', {
    'x-fixture-control': 'wrong', 'content-length': '0'
  })
  assert.equal(wrongToken.status, 404)

  const startedAt = performance.now()
  const shutdown = await call('/fixture-drain', 'POST', {
    'x-fixture-control': token, 'content-length': '0'
  })
  assert.equal(shutdown.status, 202)
  assert.equal(shutdown.body, '{"closed":true}')
  assert.equal(shutdown.connection, 'close')
  const exit = await Promise.race([death, pause(3000, null, { ref: false })])
  const exitMilliseconds = Number((performance.now() - startedAt).toFixed(1))
  assert.deepEqual(exit, [0, null])
  assert.deepEqual(childStreams.stdout, { bytes: 0, eof: true })
  assert.deepEqual(childStreams.stderr, { bytes: 0, eof: true })
  const pidWitness = readFileSync(join(scratch, 'spawn-pid'), 'utf8')
  assert.equal(pidWitness, String(child.pid) + '\n')
  const requests = readFileSync(join(scratch, 'requests'), 'utf8')
  assert.equal(requests, 'GET /healthz\nGET /app/\nGET /goblin/\nPOST /fixture-drain\nPOST /fixture-drain\n')

  const control = fileURLToPath(import.meta.url)
  console.log(JSON.stringify({
    run: 'retained rerun of the amended embedded cold gateway fixture control',
    observedAt: new Date().toISOString(),
    node: { executable: process.execPath, version: process.version, platform: process.platform, arch: process.arch },
    control: { path: control, sha256: sha256(readFileSync(control)) },
    source: {
      swiftPath,
      swiftSha256: sha256(swift),
      extractedRawSha256: sha256(raw),
      substitution: { before: replacement, after: token },
      executedProgramFile: 'embedded-fixture.mjs',
      executedProgramSha256: sha256(program),
      executedProgramBytes: Buffer.byteLength(program)
    },
    child: {
      pid: child.pid, pidWitness, port, status: exit[0], signal: exit[1],
      streams: childStreams
    },
    responses: { health, app, goblin, wrongToken, shutdown },
    requests,
    exitMilliseconds,
    exitBudgetMilliseconds: 3000
  }, null, 2))
} finally {
  agent.destroy()
  if (child.exitCode === null && child.signalCode === null) {
    child.kill()
    await death
  }
  for (const name of ['spawn-pid', 'requests']) {
    try {
      unlinkSync(join(scratch, name))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  rmdirSync(scratch)
}
