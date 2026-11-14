import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, toNamespacedPath } from 'node:path';

const maxRequestBytes = 1024 * 1024;
const maxReplyChars = 80;

/** Two finite inspections of the same output share one in-box Windows helper. */
async function openWindowsStreamCheck() {
  const root = process.env.SystemRoot;
  if (!root || !isAbsolute(root)) throw new Error('Windows SystemRoot is unavailable');
  const program = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const source = await readFile(new URL('./windows-plugin-streams.ps1', import.meta.url), 'utf8');
  return startInspection(
    program,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64'),
    ],
    { SystemRoot: root, TEMP: process.env.TEMP, TMP: process.env.TMP },
    'alternate data stream',
    toNamespacedPath,
  );
}

async function checkMacAttributes(entries) {
  for (const { path } of entries) {
    let result;
    try {
      result = await new Promise((accept, reject) => {
        execFile(
          '/usr/bin/xattr',
          ['-s', resolve(path)],
          {
            env: {},
            timeout: 3_000,
            maxBuffer: 64 * 1024,
            killSignal: 'SIGKILL',
          },
          (error, stdout, stderr) => (error ? reject(error) : accept({ stdout, stderr })),
        );
      });
    } catch {
      throw new Error(`Cannot inspect extended attributes at "${path}" with /usr/bin/xattr`);
    }
    if (result.stderr) throw new Error(`Extended attribute inspection failed at "${path}"`);
    if (result.stdout) throw new Error(`Unowned extended attribute found at "${path}"`);
  }
}

/** Inspect user-accessible metadata on the finite list, before and after moving the incumbent. */
export async function openOutputMetadataCheck(platform = process.platform) {
  if (platform === 'win32') return openWindowsStreamCheck();
  if (platform === 'darwin') return { check: checkMacAttributes, finish() {}, close() {} };
  if (platform !== 'linux')
    throw new Error('Output metadata inspection is unavailable on this platform');
  const source = await readFile(new URL('./linux-plugin-attributes.py', import.meta.url), 'utf8');
  return startInspection(
    '/usr/bin/python3',
    ['-I', '-S', '-X', 'utf8', '-c', source],
    {},
    'extended attribute',
  );
}

function startInspection(program, args, env, kind, mapPath = (path) => path) {
  const child = spawn(program, args, {
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  let processFailed = false;
  child.on('error', () => {
    processFailed = true;
  });
  child.stdin.on('error', () => {
    processFailed = true;
  });
  const exit = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('close', (code) => resolve(code)); // Includes launch failures before 'exit'.
  });
  const deadline = setTimeout(() => {
    processFailed = true;
    child.kill('SIGKILL');
    child.stdin.destroy();
    // The OS compiler may inherit a pipe during Windows Add-Type startup.
    child.stdout.destroy();
  }, 15_000);
  const output = child.stdout.setEncoding('utf8')[Symbol.asyncIterator]();

  async function readReply() {
    let reply = '';
    while (!reply.endsWith('\n')) {
      const part = await output.next();
      if (part.done || processFailed)
        throw new Error('Output metadata inspection ended without a response');
      reply += part.value;
      if (reply.length > maxReplyChars)
        throw new Error('Output metadata inspection response is too long');
    }
    return reply.replace(/\r?\n$/, '');
  }

  return {
    async check(entries) {
      const request =
        JSON.stringify(
          entries.map(({ path, directory }) => ({
            path: mapPath(path),
            directory,
          })),
        ) + '\n';
      if (Buffer.byteLength(request) > maxRequestBytes)
        throw new Error('Output metadata inspection request is too large');
      await new Promise((resolve, reject) =>
        child.stdin.write(request, (error) => (error ? reject(error) : resolve())),
      );
      const reply = await readReply();
      if (reply === 'ok') return;
      const match = /^(?:foreign:(\d+)|error:(\d+):([1-9]\d*))$/.exec(reply);
      const entry = match && entries[Number(match[1] ?? match[2])];
      if (!entry) throw new Error('Output metadata inspection returned an invalid response');
      if (match[3])
        throw new Error(
          `Cannot inspect ${kind} data at "${entry.path}" (platform error ${match[3]})`,
        );
      throw new Error(`Unowned ${kind} found at "${entry.path}"`);
    },
    async finish() {
      child.stdin.end();
      if (!(await output.next()).done || (await exit) !== 0 || processFailed)
        throw new Error('Output metadata inspection did not finish successfully');
      clearTimeout(deadline);
    },
    async close() {
      clearTimeout(deadline);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      child.stdin.destroy();
      child.stdout.destroy();
      await exit;
    },
  };
}
