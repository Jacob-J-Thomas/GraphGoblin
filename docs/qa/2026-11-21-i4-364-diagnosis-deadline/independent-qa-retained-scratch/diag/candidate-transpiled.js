"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runClaudeProcess = void 0;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const index_js_1 = require("../process/index.js");
const errors_js_1 = require("./errors.js");
const domain_1 = require("@graphgoblin/domain");
const START_REFUSAL_DIAGNOSIS_MS = 1000;
async function pathState(path) {
    try {
        return (await (0, promises_1.stat)(path)).isDirectory() ? 'directory' : 'other';
    }
    catch (error) {
        const code = error.code;
        // Only a definite absence counts; access, length or other read faults leave the cause unknown.
        return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unknown';
    }
}
/**
 * Read-only observation after a spawn refusal (#364). A spawn `ENOENT` does not say which operand
 * failed: Windows also reports a missing, non-folder or overlong working directory that way. An
 * executable counts as missing only for a fully qualified path whose every name Windows process
 * start tries (the path, then with `.com` and `.exe` appended) is absent or a folder; a bare name
 * or relative path is never resolved here. An existing folder is not proof that a process can
 * start in it, so it establishes nothing.
 */
async function observeStartRefusal(request, code, current) {
    if (!current())
        return undefined;
    const observePath = (path) => current() ? pathState(path) : Promise.resolve('unknown');
    const binary = request.binary;
    if (code === 'ENOENT' && (0, node_path_1.isAbsolute)(binary) && (0, node_path_1.resolve)(binary) === (0, node_path_1.normalize)(binary)) {
        const names = process.platform === 'win32' ? [binary, `${binary}.com`, `${binary}.exe`] : [binary];
        const states = await Promise.all(names.map(observePath));
        if (!current())
            return undefined;
        if (states.every((state) => state === 'missing' || state === 'directory'))
            return 'executable-missing';
    }
    const directory = await observePath(request.cwd);
    if (!current())
        return undefined;
    if (directory === 'missing')
        return 'working-directory-missing';
    if (directory === 'other')
        return 'working-directory-not-directory';
    return undefined;
}
/** Own every child and its descendants, with no shell, bounded capture and fixed diagnostic codes. */
const runClaudeProcess = (request, onStdout, 
/** Optional ephemeral observer; stderr is never retained in the result. */
onStderr) => new Promise((resolve) => {
    const empty = { exitCode: null, stdout: '', timedOut: false, aborted: false, overflow: false };
    if (request.signal.aborted) {
        resolve({ ...empty, aborted: true });
        return;
    }
    const child = (0, node_child_process_1.spawn)(request.binary, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', bytes = 0, settled = false, timedOut = false, overflow = false, stdinFailed = false, outputFailed = false;
    let callbackError, spawnCode;
    let startRefusal;
    let killing;
    let closed = false;
    let treeConfirmed = false;
    let closeCode = null;
    let killTimer;
    let diagnosticTimer;
    let diagnostic = '';
    let rejection;
    const finish = (exitCode, terminationUnconfirmed = false) => {
        if (settled)
            return;
        settled = true;
        clearTimeout(timer);
        if (killTimer)
            clearTimeout(killTimer);
        if (diagnosticTimer)
            clearTimeout(diagnosticTimer);
        request.signal.removeEventListener('abort', kill);
        resolve({
            exitCode,
            stdout,
            timedOut,
            aborted: request.signal.aborted,
            overflow,
            ...(terminationUnconfirmed ? { terminationUnconfirmed: true } : {}),
            ...(spawnCode ? { spawnCode } : {}),
            ...(startRefusal ? { startRefusal } : {}),
            ...(exitCode !== 0 && rejection ? { turnRejection: rejection } : {}),
            ...(stdinFailed ? { stdinFailed } : {}),
            ...(outputFailed ? { outputFailed: true } : {}),
            ...(callbackError ? { callbackError } : {}),
            ...(request.classifyDiagnostics && exitCode !== 0 && diagnostic
                ? { failureState: (0, domain_1.cliFailureState)(diagnostic) }
                : {}),
            ...(request.classifyDiagnostics && /\bnot logged in\b/i.test(diagnostic)
                ? { notLoggedIn: true }
                : {}),
        });
    };
    const kill = () => {
        if (settled)
            return;
        clearTimeout(timer);
        // A refused start has no process to stop: report the refusal now, without its diagnosis.
        if (spawnCode) {
            finish(null);
            return;
        }
        if (killing)
            return;
        killTimer = setTimeout(() => finish(null, true), 5000);
        killing = (0, index_js_1.killTree)(child);
        void killing.then((confirmed) => {
            if (!confirmed)
                finish(null, true);
            else {
                treeConfirmed = true;
                if (closed)
                    finish(closeCode);
            }
        });
    };
    const timer = request.timeoutMs === null
        ? undefined
        : setTimeout(() => {
            // A process that never started cannot have timed out.
            if (!spawnCode)
                timedOut = true;
            kill();
        }, request.timeoutMs);
    request.signal.addEventListener('abort', kill, { once: true });
    const collect = (chunk, output) => {
        if (settled || overflow || callbackError)
            return;
        bytes += chunk.byteLength;
        if (bytes > request.maxOutputBytes) {
            overflow = true;
            kill();
            return;
        }
        try {
            // Keep only stderr in this ephemeral window. Turn stdout can contain authored/model text.
            // The same bounded buffer supports turn refusals and probe-only sign-out inference;
            // only fixed classifications leave it. Probe stdout is inspected separately by the harness.
            if (!output) {
                diagnostic = (diagnostic + chunk.toString('utf8')).slice(-8192);
                if (/^(?:Error: )?No conversation found with session ID:/im.test(diagnostic))
                    rejection = 'session-missing';
                else if (/^error: (?:unknown option|unexpected argument)/im.test(diagnostic))
                    rejection = 'arguments';
                else if (/^(?:Error: )?(?:Not logged in|Invalid API key|Authentication required)\b/im.test(diagnostic))
                    rejection = 'auth';
            }
            if (output) {
                stdout += chunk.toString('utf8');
                onStdout?.(chunk);
            }
            else
                onStderr?.(chunk);
        }
        catch (error) {
            callbackError =
                error instanceof errors_js_1.ClaudeHarnessError
                    ? error
                    : new errors_js_1.ClaudeHarnessError('HARNESS_PROTOCOL_ERROR', 'Claude stream parser failed');
            kill();
        }
    };
    // Node has no pid only for a child that never started. Its pipes can still fail afterwards (on
    // Windows from a 260-character working directory, stdout and stderr fail with ENOTCONN); the
    // refusal itself arrives as the child's error event, so those secondary faults are ignored.
    const started = () => child.pid !== undefined;
    const outputFault = () => {
        if (!started())
            return;
        outputFailed = true;
        kill();
    };
    child.stdout?.on('data', (chunk) => collect(chunk, true));
    child.stderr?.on('data', (chunk) => collect(chunk, false));
    child.stdout?.on('error', outputFault);
    child.stderr?.on('error', outputFault);
    child.on('error', (error) => {
        // Only an actual spawn refusal proves that nothing started. A later error, such as a failed
        // kill, leaves the close and termination outcomes authoritative.
        if (settled || spawnCode || started())
            return;
        const code = error.code === 'ENOENT' ? 'ENOENT' : error.code === 'EACCES' ? 'EACCES' : 'UNKNOWN';
        spawnCode = code;
        // Optional metadata must not hold a proved refusal open, even for an unbounded turn.
        // The absolute monotonic deadline also rejects late metadata before a delayed timer runs.
        const deadline = performance.now() + START_REFUSAL_DIAGNOSIS_MS;
        const current = () => !settled && performance.now() < deadline;
        const expire = () => {
            if (settled)
                return;
            const remaining = deadline - performance.now();
            if (remaining > 0)
                diagnosticTimer = setTimeout(expire, remaining);
            else
                finish(null);
        };
        diagnosticTimer = setTimeout(expire, START_REFUSAL_DIAGNOSIS_MS);
        void observeStartRefusal(request, code, current).then((observed) => {
            if (settled)
                return;
            if (current())
                startRefusal = observed;
            finish(null);
        });
    });
    child.on('close', (code) => {
        closed = true;
        closeCode = code;
        // After a refusal Node still closes the child; the refusal path settles the result.
        if (spawnCode)
            return;
        if (!killing || treeConfirmed)
            finish(code);
    });
    child.stdin?.on('error', () => {
        if (!started())
            return;
        stdinFailed = true;
        kill();
    });
    child.stdin?.end(request.stdin ?? '');
});
exports.runClaudeProcess = runClaudeProcess;
//# sourceMappingURL=process.js.map