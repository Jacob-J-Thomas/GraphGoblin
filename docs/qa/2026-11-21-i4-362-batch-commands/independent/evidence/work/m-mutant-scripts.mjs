// MUTANT CONTROL generated from G:\ggq\gg-i4-362-qa\GraphGoblin\packages\infrastructure\dist\process\scripts.js (sha256 2f820e07f4af75532ba0d81df1c9cb5e8523676a601b6da0fa2f539a4d83ee3b); sync spawn catch removed. NOT PRODUCTION.
import { spawn } from 'node:child_process';
import { BoundedOutputCapture } from 'file:///G:/ggq/gg-i4-362-qa/GraphGoblin/packages/infrastructure/dist/process/output-capture.js';
/** `taskkill` exit code when no process with the PID exists. */
const TASKKILL_NOT_FOUND = 128;
const hasExited = (child) => child.exitCode !== null || child.signalCode !== null;
/**
 * Kill a process and everything it started. Windows has no process groups or POSIX signals, so
 * `taskkill /T /F` is used there; elsewhere the child was started detached as a group leader and
 * the whole group is signalled.
 *
 * On Windows a root that is verifiably gone counts as released: Node has observed its exit, or
 * taskkill found no process with its PID and Node then reports the exit. A root Node saw exit is
 * never signalled, because Node has closed its handle and Windows may already have reused the PID.
 * Any other taskkill failure leaves the state undetermined and reports `false`. A descendant that
 * inherited the root's output keeps it open; callers confirm release only when it closes.
 */
export function killTree(child, platform = process.platform, spawnImpl = spawn) {
    if (child.pid === undefined)
        return Promise.resolve(true);
    if (platform === 'win32') {
        if (hasExited(child))
            return Promise.resolve(true);
        return new Promise((resolve) => {
            let killer;
            try {
                killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
                    stdio: 'ignore',
                    windowsHide: true,
                });
            }
            catch {
                try {
                    child.kill();
                }
                catch {
                    /* no confirmed root cleanup */
                }
                resolve(false);
                return;
            }
            // Killing just the root is best effort; it never establishes tree cleanup.
            killer.once('error', () => {
                try {
                    child.kill();
                }
                catch {
                    /* no confirmed root cleanup */
                }
                resolve(false);
            });
            killer.once('close', (code) => {
                if (code !== TASKKILL_NOT_FOUND)
                    resolve(code === 0);
                // No process has the PID, so the root is no longer running: it exited on its own before
                // taskkill looked. Release is claimed once Node reports that exit; the caller's deadline
                // bounds this wait.
                else if (hasExited(child))
                    resolve(true);
                else
                    child.once('exit', () => resolve(true));
            });
        });
    }
    try {
        process.kill(-child.pid, 'SIGKILL');
        return Promise.resolve(true);
    }
    catch {
        try {
            child.kill('SIGKILL');
        }
        catch {
            /* no confirmed root cleanup */
        }
        return Promise.resolve(false);
    }
}
export class ProcessScripts {
    maxOutputBytes;
    baseEnv;
    spawnImpl;
    platform;
    constructor(options = {}) {
        this.maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
        this.baseEnv = options.baseEnv ?? process.env;
        this.spawnImpl = options.spawnImpl ?? spawn;
        this.platform = options.platform ?? process.platform;
    }
    run(request) {
        const notStarted = {
            state: 'definitely-not-started',
            exitCode: null,
            stdout: '',
            stderr: '',
            stdoutBytes: 0,
            stderrBytes: 0,
            timedOut: false,
            stdoutOverflow: false,
            stderrOverflow: false,
        };
        // Do not spawn and then kill a command whose cancellation is already known.
        if (request.signal.aborted)
            return Promise.resolve(notStarted);
        const stdout = new BoundedOutputCapture(request.maxStdoutBytes ?? this.maxOutputBytes);
        const stderr = new BoundedOutputCapture(request.maxStderrBytes ?? this.maxOutputBytes);
        return new Promise((resolve) => {
            let child;
            {
                child = this.spawnImpl(request.command, request.args, {
                    cwd: request.cwd,
                    env: { ...(request.inheritEnv === false ? {} : this.baseEnv), ...request.env },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                    detached: this.platform !== 'win32',
                    shell: false,
                });
            }
            let spawned = false;
            child.once('spawn', () => {
                spawned = true;
            });
            let timedOut = false;
            let settled = false;
            let killing;
            let closed = false;
            let treeConfirmed = false;
            let closeCode = null;
            let cleanupTimer;
            child.stdout?.on('data', (chunk) => {
                if (!settled)
                    stdout.append(chunk);
            });
            child.stderr?.on('data', (chunk) => {
                if (!settled)
                    stderr.append(chunk);
            });
            const kill = () => {
                if (settled || killing)
                    return;
                // Five seconds bounds acknowledgement of explicit native termination, not normal drain.
                cleanupTimer = setTimeout(() => finish(null, 'outcome-uncertain', true), 5000);
                killing = killTree(child, this.platform, this.spawnImpl);
                void killing.then((confirmed) => {
                    if (!confirmed)
                        finish(null, 'outcome-uncertain', true);
                    else {
                        treeConfirmed = true;
                        if (closed)
                            finish(closeCode);
                    }
                });
            };
            const timer = request.timeoutMs !== undefined
                ? setTimeout(() => {
                    timedOut = true;
                    kill();
                }, request.timeoutMs)
                : undefined;
            const onAbort = () => kill();
            const finish = (exitCode, state = 'completed', terminationUnconfirmed = false) => {
                if (settled)
                    return;
                settled = true;
                if (timer)
                    clearTimeout(timer);
                clearTimeout(cleanupTimer);
                request.signal.removeEventListener('abort', onAbort);
                const errorText = stderr.text();
                resolve({
                    state,
                    exitCode,
                    ...(terminationUnconfirmed ? { terminationUnconfirmed: true } : {}),
                    timedOut,
                    stdout: stdout.text(),
                    stdoutBytes: stdout.byteLength,
                    stderrBytes: stderr.byteLength,
                    stderr: state === 'definitely-not-started' && request.maxStderrBytes === undefined
                        ? `${errorText}${errorText ? '\n' : ''}spawn failed: PROCESS_START_FAILED`
                        : errorText,
                    stderrOverflow: stderr.overflow,
                    stdoutOverflow: stdout.overflow,
                });
            };
            child.on('error', () => {
                if (spawned)
                    kill();
                finish(null, spawned ? 'outcome-uncertain' : 'definitely-not-started');
            });
            child.on('close', (code) => {
                closed = true;
                closeCode = code;
                if (!killing || treeConfirmed)
                    finish(code);
            });
            if (request.signal.aborted)
                onAbort();
            else
                request.signal.addEventListener('abort', onAbort, { once: true });
            if (child.stdin) {
                child.stdin.on('error', () => undefined);
                if (request.stdin !== undefined)
                    child.stdin.end(request.stdin);
                else
                    child.stdin.end();
            }
        });
    }
}
//# sourceMappingURL=scripts.js.map