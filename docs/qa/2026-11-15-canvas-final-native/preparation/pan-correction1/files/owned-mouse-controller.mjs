import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

export async function ownedMouseController(output, fixtureStartedUtc, helperPath) {
  const key = randomBytes(24).toString('hex');
  const marker = 'GG207 Owned ' + randomBytes(16).toString('hex');
  const fixtureTemp = join(output, 'owned-mouse-temp');
  await mkdir(fixtureTemp);
  let previous = null;
  let stageIndex = 0;
  let busy = false;
  const sent = (response, code, payload) => {
    response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(payload));
  };
  const server = createServer({ maxHeaderSize: 3072, requestTimeout: 20000 }, async (request, response) => {
    if (request.socket.remoteAddress !== '127.0.0.1' || request.method !== 'POST' || request.url !== '/mouse' ||
        request.headers['x-gg207-owned-mouse'] !== key) {
      sent(response, 403, { refused: 'Disposable controller authentication' });
      return;
    }
    if (busy || stageIndex >= 2) {
      sent(response, 409, { refused: 'Only one calibrated double-click per fixture' });
      return;
    }
    busy = true;
    const stage = ['move', 'double'][stageIndex++];
    let record;
    try {
      const chunks = [];
      let size = 0;
      for await (const data of request) {
        size += data.length;
        assert(size <= 1024, 'Calibration request exceeds limit');
        chunks.push(data);
      }
      const body = JSON.parse(Buffer.concat(chunks));
      assert.equal(body.stage, stage, 'Out-of-order calibration stage');
      const coords = [body.screenX, body.screenY];
      assert(coords.every((value) => Number.isInteger(value) && value >= 0 && value <= 32767), 'Invalid screen coordinate');
      assert(Number.isInteger(body.browserPid) && body.browserPid > 0 && body.browserPid <= 2147483647);
      const identity = [body.browserPid, ...coords];
      if (stage === 'double') {
        assert(previous && !previous.result.operation?.limited, 'Successful guarded move must precede injection');
        assert.deepEqual(identity, previous.identity, 'Calibrated browser PID/point changed between requests');
      }
      const raw = execFileSync('pwsh.exe', [
        '-NoProfile', '-NonInteractive', '-File', helperPath, '-Stage', stage, '-BrowserPid', String(body.browserPid),
        '-Marker', marker, '-FixtureStartedUtc', fixtureStartedUtc, '-FixtureTemp', fixtureTemp,
        '-ScreenX', String(coords[0]), '-ScreenY', String(coords[1]),
        ...(stage === 'double' ? ['-ExpectedHwnd', previous.result.operation.hwnd,
          '-ExpectedBirthUtc', previous.result.processBirthUtc] : []),
      ], { cwd: output, windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024, encoding: 'utf8' });
      const result = JSON.parse(raw.trim());
      if (stage === 'move') previous = { identity, result };
      if (stage === 'double') {
        assert.equal(result.processBirthUtc, previous.result.processBirthUtc, 'Injection PID birth differs from move');
        assert.equal(result.operation.hwnd, previous.result.operation.hwnd, 'Injection HWND differs from move');
      }
      record = { ...result, fixtureStartedUtc };
      await writeFile(join(output, 'owned-mouse-' + stage + '.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
      sent(response, 200, record);
    } catch (error) {
      record = { stage, fixtureStartedUtc, recordedUtc: new Date().toISOString(),
        refused: String(error.message).slice(0, 1600), source: 'disposable-owned-window-controller' };
      await writeFile(join(output, 'owned-mouse-' + stage + '-refusal.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
      sent(response, 422, record);
    } finally {
      busy = false;
    }
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = server.address();
  if ([4747, 4748].includes(port)) {
    await new Promise((done) => server.close(done));
    throw new Error('Disposable coordinator selected a reserved owner port');
  }
  return {
    port, fixtureTemp,
    query: { ownedMouseEndpoint: 'http://127.0.0.1:' + port + '/mouse', ownedMouseKey: key, ownedMouseMarker: marker },
    close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
  };
}
