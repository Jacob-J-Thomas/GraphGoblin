// GraphGoblin #459 independent QA fixture: private handshake client (not product code).
// A fixture announces itself on the driver's private pipe and blocks until the driver's native
// witness holds an exact handle to it, so its PID cannot be reused before the handle exists.
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';

export const CODES = Object.freeze({
  member: 41,
  psQuery: 43,
  gatewayDrained: 44,
  gatewayMaxLife: 45,
  sentinel: 46,
  released: 47,
  driverGone: 48,
  rootMaxLife: 49,
  setupFault: 97,
});

/** Resolves after the driver acknowledged; `onCommand` receives later driver lines. */
export function handshake(role, extra = {}, onCommand = () => {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(`\\\\.\\pipe\\${process.env.QA459_PIPE}`);
    let buffer = '';
    let acknowledged = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('handshake-timeout'));
    }, 10_000);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(
        JSON.stringify({
          hello: 1,
          token: process.env.QA459_TOKEN,
          case: process.env.QA459_CASE,
          role,
          pid: process.pid,
          ppid: process.ppid,
          ...extra,
        }) + '\n',
      );
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (!acknowledged) {
          clearTimeout(timer);
          acknowledged = true;
          if (message.ack === true) resolve(socket);
          else reject(new Error('handshake-refused'));
        } else onCommand(message);
      }
    });
    // A broken driver connection is ignored after acknowledgement: fixtures outlive it.
    socket.on('error', (error) => {
      if (!acknowledged) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

/** Marks a role ready inside the case directory, after the driver holds its handle. */
export function markReady(caseDir, role) {
  mkdirSync(join(caseDir, 'ready'), { recursive: true });
  writeFileSync(join(caseDir, 'ready', role), String(process.pid));
}

/** The kind of an inherited standard handle, self-reported (not independent evidence). */
export function stdioKinds(fstatSync) {
  const kind = (fd) => {
    try {
      const stats = fstatSync(fd);
      if (stats.isFIFO()) return 'pipe';
      if (stats.isCharacterDevice()) return 'char';
      if (stats.isFile()) return 'file';
      if (stats.isSocket()) return 'socket';
      return 'other';
    } catch (error) {
      return `error:${error?.code ?? 'unknown'}`;
    }
  };
  return { stdin: kind(0), stdout: kind(1), stderr: kind(2) };
}
