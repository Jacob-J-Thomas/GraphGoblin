import Darwin
import Dispatch
import Foundation

package struct AttemptTime: Sendable {
    package let end: UInt64

    package init(seconds: UInt64) {
        end = DispatchTime.now().uptimeNanoseconds + seconds * 1_000_000_000
    }

    init(end: UInt64) { self.end = end }

    var remaining: UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        return end > now ? end - now : 0
    }

    var expired: Bool { remaining == 0 }

    func window(milliseconds: UInt64) -> AttemptTime {
        AttemptTime(end: min(end, DispatchTime.now().uptimeNanoseconds + milliseconds * 1_000_000))
    }

    func pause(milliseconds: UInt64 = 25) {
        let duration = min(remaining, milliseconds * 1_000_000)
        if duration > 0 { _ = usleep(useconds_t((duration + 999) / 1_000)) }
    }
}

enum OperationRefusal: Error {
    case deadline
    case cancelled
    case invalid
    case disconnected
}

struct OperationLimit {
    let time: AttemptTime
    let quitting: () -> Bool

    func check() throws {
        if quitting() { throw OperationRefusal.cancelled }
        if time.expired { throw OperationRefusal.deadline }
    }

    func poll(_ entries: inout [pollfd]) throws {
        try check()
        let milliseconds = Int32(min(25, (time.remaining + 999_999) / 1_000_000))
        let count = nfds_t(entries.count)
        let result = Darwin.poll(&entries, count, milliseconds)
        if result < 0 && errno != EINTR { throw FileRefusal.system(errno) }
        try check()
    }
}

enum ChildStatus: Equatable {
    case running
    case exited(Int32)
    case signaled(Int32)
    case unknown
}

final class DirectChild {
    let pid: pid_t
    private var status: ChildStatus = .running

    init(pid: pid_t) { self.pid = pid }

    func observe() -> ChildStatus {
        guard status == .running else { return status }
        var value: Int32 = 0
        let waited = waitpid(pid, &value, WNOHANG)
        if waited == pid {
            let signal = value & 0x7F
            status = signal == 0 ? .exited((value >> 8) & 0xFF) : .signaled(signal)
        } else if waited == -1 && errno != EINTR {
            status = .unknown
        }
        return status
    }

    func stopReadOnlyChild(within time: AttemptTime) {
        guard observe() == .running else { return }
        // A direct child cannot have its PID reused before this wait owner reaps it.
        _ = kill(pid, SIGKILL)
        while observe() == .running && !time.expired {
            time.pause(milliseconds: 5)
        }
    }
}

enum ChildSpawnError: Error {
    case noChild
    case unknownChild
}

package func normalizeChildStatusDisposition() throws {
    var disposition = sigaction()
    disposition.__sigaction_u.__sa_handler = SIG_DFL
    sigemptyset(&disposition.sa_mask)
    disposition.sa_flags = 0
    guard sigaction(SIGCHLD, &disposition, nil) == 0 else {
        throw FileRefusal.system(errno)
    }
}

private struct CapturePipe {
    let receiver: OwnedDescriptor
    let writer: OwnedDescriptor

    init() throws {
        var descriptors = [Int32](repeating: -1, count: 2)
        guard pipe(&descriptors) == 0 else { throw FileRefusal.system(errno) }
        defer {
            _ = close(descriptors[0])
            _ = close(descriptors[1])
        }
        receiver = try OwnedDescriptor(fcntl(descriptors[0], F_DUPFD_CLOEXEC, Int32(3)))
        writer = try OwnedDescriptor(fcntl(descriptors[1], F_DUPFD_CLOEXEC, Int32(3)))
        guard fcntl(receiver.fd, F_SETFL, O_NONBLOCK) == 0 else { throw FileRefusal.system(errno) }
    }
}

struct SpawnCommand {
    let executable: String
    let arguments: [String]
    let cwd: String
    let environment: [String: String]

    func gateway() throws -> DirectChild {
        try spawn(detached: true, stdout: nil, stderr: nil)
    }

    fileprivate func spawn(detached: Bool, stdout: Int32?, stderr: Int32?) throws -> DirectChild {
        var actions: posix_spawn_file_actions_t?
        var attrs: posix_spawnattr_t?
        try check(posix_spawn_file_actions_init(&actions))
        defer { posix_spawn_file_actions_destroy(&actions) }
        try check(posix_spawnattr_init(&attrs))
        defer { posix_spawnattr_destroy(&attrs) }

        var flags = Int16(POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGMASK)
        if detached { flags |= Int16(POSIX_SPAWN_SETSID) }
        try check(posix_spawnattr_setflags(&attrs, flags))
        var mask = sigset_t()
        sigemptyset(&mask)
        try check(posix_spawnattr_setsigmask(&attrs, &mask))
        #if compiler(>=6.2)
        if #available(macOS 26, *) {
            try check(posix_spawn_file_actions_addchdir(&actions, cwd))
        } else {
            try check(posix_spawn_file_actions_addchdir_np(&actions, cwd))
        }
        #else
        try check(posix_spawn_file_actions_addchdir_np(&actions, cwd))
        #endif
        try check(posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0))
        for (target, source) in [(STDOUT_FILENO, stdout), (STDERR_FILENO, stderr)] {
            if let source {
                try check(posix_spawn_file_actions_adddup2(&actions, source, target))
            } else {
                try check(posix_spawn_file_actions_addopen(&actions, target, "/dev/null", O_WRONLY, 0))
            }
        }
        var pid: pid_t = 0
        let result = try withCStringVector([executable] + arguments) { argv in
            try withCStringVector(environment.keys.sorted().map { $0 + "=" + environment[$0]! }) { envp in
                posix_spawn(&pid, executable, &actions, &attrs, argv, envp)
            }
        }
        if result != 0 {
            guard pid == 0 else { throw ChildSpawnError.unknownChild }
            throw ChildSpawnError.noChild
        }
        guard pid > 0 else { throw ChildSpawnError.unknownChild }
        return DirectChild(pid: pid)
    }

    private func check(_ result: Int32) throws {
        guard result == 0 else { throw ChildSpawnError.noChild }
    }
}

private func withCStringVector<T>(
    _ values: [String], _ body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) throws -> T
) throws -> T {
    var vector: [UnsafeMutablePointer<CChar>?] = []
    defer { for address in vector { free(address) } }
    for value in values {
        guard !value.utf8.contains(0), let address = strdup(value) else { throw ChildSpawnError.noChild }
        vector.append(address)
    }
    vector.append(nil)
    return try vector.withUnsafeMutableBufferPointer { try body($0.baseAddress!) }
}

package struct CapturedOutput {
    package let stdout: Data
    package let stderr: Data
    package let exitCode: Int32
}

package func captureReadOnly(
    executable: String, arguments: [String], cwd: String, environment: [String: String],
    time: AttemptTime, quitting: @escaping () -> Bool = { false }, requireExitZero: Bool = true
) throws -> CapturedOutput {
    // Reserve a small part of the same deadline to terminate and reap only this helper.
    let limit = OperationLimit(time: AttemptTime(end: time.end - 40_000_000), quitting: quitting)
    try limit.check()
    let command = SpawnCommand(executable: executable, arguments: arguments, cwd: cwd, environment: environment)
    let (child, receivers) = try startCapturing(command)
    do {
        var open = [true, true]
        var retained = [Data(), Data()]
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while true {
            try limit.check()
            let status = child.observe()
            if status == .unknown { throw OperationRefusal.invalid }
            if !open.contains(true) && status != .running {
                guard case .exited(let code) = status, !requireExitZero || code == 0 else {
                    throw OperationRefusal.invalid
                }
                return CapturedOutput(stdout: retained[0], stderr: retained[1], exitCode: code)
            }
            var fds = receivers.enumerated().map { index, handle in
                pollfd(fd: open[index] ? handle.fd : -1, events: Int16(POLLIN), revents: 0)
            }
            try limit.poll(&fds)
            for index in fds.indices where fds[index].revents != 0 {
                let count = buffer.withUnsafeMutableBytes { read(receivers[index].fd, $0.baseAddress, $0.count) }
                if count == 0 {
                    open[index] = false
                } else if count > 0 {
                    guard retained[index].count + count <= 8_192 else { throw OperationRefusal.invalid }
                    retained[index].append(contentsOf: buffer.prefix(count))
                } else if errno != EINTR && errno != EAGAIN {
                    throw FileRefusal.system(errno)
                }
            }
        }
    } catch {
        child.stopReadOnlyChild(within: time.window(milliseconds: 250))
        throw error
    }
}

private func startCapturing(_ command: SpawnCommand) throws -> (DirectChild, [OwnedDescriptor]) {
    let output = try CapturePipe()
    let errors = try CapturePipe()
    let child = try command.spawn(detached: false, stdout: output.writer.fd, stderr: errors.writer.fd)
    return (child, [output.receiver, errors.receiver])
}
