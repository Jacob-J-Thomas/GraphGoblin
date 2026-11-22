import { spawn } from 'node:child_process';
import { killTree } from "file:///G:/ggq/gg-i4-364-qa/GraphGoblin/packages/infrastructure/dist/process/index.js";
import { ClaudeHarnessError } from "file:///G:/ggq/gg-i4-364-qa/GraphGoblin/packages/infrastructure/dist/claude/errors.js";
import { cliFailureState } from "file:///G:/ggq/gg-i4-364-qa/GraphGoblin/packages/domain/dist/index.js";
/** Own every child and its descendants, with no shell, bounded capture and fixed diagnostic codes. */
export const runClaudeProcess = (request, onStdout, 
/** Optional ephemeral observer; stderr is never retained in the result. */
onStderr) => new Promise((resolve) => {
    const empty = { exitCode: null, stdout: '', timedOut: false, aborted: false, overflow: false };
    if (request.signal.aborted) {
        resolve({ ...empty, aborted: true });
        return;
    }
    const child = spawn(request.binary, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', bytes = 0, settled = false, timedOut = false, overflow = false, stdinFailed = false;
    let callbackError, spawnCode;
    let killing;
    let closed = false;
    let treeConfirmed = false;
    let closeCode = null;
    let killTimer;
    let diagnostic = '';
    let rejection;
    const finish = (exitCode, terminationUnconfirmed = false) => {
        if (settled)
            return;
        settled = true;
        clearTimeout(timer);
        if (killTimer)
            clearTimeout(killTimer);
        request.signal.removeEventListener('abort', kill);
        resolve({
            exitCode,
            stdout,
            timedOut,
            aborted: request.signal.aborted,
            overflow,
            ...(terminationUnconfirmed ? { terminationUnconfirmed: true } : {}),
            ...(spawnCode ? { spawnCode } : {}),
            ...(exitCode !== 0 && rejection ? { turnRejection: rejection } : {}),
            ...(stdinFailed ? { stdinFailed } : {}),
            ...(callbackError ? { callbackError } : {}),
            ...(request.classifyDiagnostics && exitCode !== 0 && diagnostic
                ? { failureState: cliFailureState(diagnostic) }
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
        if (killing)
            return;
        killTimer = setTimeout(() => finish(null, true), 5000);
        killing = killTree(child);
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
                error instanceof ClaudeHarnessError
                    ? error
                    : new ClaudeHarnessError('HARNESS_PROTOCOL_ERROR', 'Claude stream parser failed');
            kill();
        }
    };
    child.stdout?.on('data', (chunk) => collect(chunk, true));
    child.stderr?.on('data', (chunk) => collect(chunk, false));
    child.on('error', (error) => {
        spawnCode =
            error.code === 'ENOENT' ? 'ENOENT' : error.code === 'EACCES' ? 'EACCES' : 'UNKNOWN';
        finish(null);
    });
    child.on('close', (code) => {
        closed = true;
        closeCode = code;
        if (!killing || treeConfirmed)
            finish(code);
    });
    child.stdin?.on('error', () => {
        stdinFailed = true;
        kill();
    });
    child.stdin?.end(request.stdin ?? '');
});
