import CryptoKit
import Darwin
import Foundation

package enum FileRefusal: Error {
    case invalid
    case system(Int32)
}

package final class OwnedDescriptor: @unchecked Sendable {
    package let fd: Int32

    package init(_ fd: Int32) throws {
        guard fd >= 0 else { throw FileRefusal.system(errno) }
        self.fd = fd
    }

    deinit { _ = close(fd) }

    package func metadata() throws -> stat {
        var result = stat()
        guard fstat(fd, &result) == 0 else { throw FileRefusal.system(errno) }
        return result
    }
}

package struct FileIdentity: Codable, Equatable, Sendable {
    package let device: String
    package let inode: String

    package init(device: dev_t, inode: ino_t) {
        self.device = String(UInt64(bitPattern: Int64(device)))
        self.inode = String(UInt64(inode))
    }

    package init(_ metadata: stat) {
        self.init(device: metadata.st_dev, inode: metadata.st_ino)
    }

    package var isCanonical: Bool {
        [device, inode].allSatisfy { text in
            UInt64(text).map { String($0) == text } ?? false
        }
    }
}

package func fileKind(_ metadata: stat, _ type: mode_t) -> Bool {
    metadata.st_mode & S_IFMT == type
}

package func isOwnedFile(_ metadata: stat, privateMode: Bool) -> Bool {
    fileKind(metadata, S_IFREG) && metadata.st_uid == geteuid() && metadata.st_nlink == 1
        && metadata.st_mode & mode_t(privateMode ? 0o077 : 0o022) == 0
}

package func safeComponent(_ name: String) -> Bool {
    !name.isEmpty && name != "." && name != ".."
        && !name.utf8.contains(0) && !name.utf8.contains(47)
}

package func absolutePath(_ value: String) -> Bool {
    value.hasPrefix("/") && !value.utf8.contains(0)
}

package func canonicalPath(_ path: String) throws -> String {
    guard absolutePath(path) else { throw FileRefusal.invalid }
    guard let resolved = realpath(path, nil) else { throw FileRefusal.system(errno) }
    defer { free(resolved) }
    guard let valid = String(validatingCString: resolved) else { throw FileRefusal.invalid }
    return valid
}

package func authenticatedHome() throws -> String {
    guard getuid() == geteuid(), let pointer = getpwuid(geteuid()),
          let home = pointer.pointee.pw_dir,
          let path = String(validatingCString: home) else {
        throw FileRefusal.invalid
    }
    return try canonicalPath(path)
}

package struct Directory: Sendable {
    package let handle: OwnedDescriptor
    package let path: String
    package let identity: FileIdentity

    package init(path: String) throws {
        guard absolutePath(path) else { throw FileRefusal.invalid }
        var current = try OwnedDescriptor(open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC))
        for part in path.split(separator: "/") {
            guard safeComponent(String(part)) else { throw FileRefusal.invalid }
            current = try OwnedDescriptor(openat(
                current.fd, String(part), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
            ))
        }
        self.init(path: path, handle: current, identity: FileIdentity(try current.metadata()))
    }

    package init(path: String, handle: OwnedDescriptor, identity: FileIdentity) {
        self.path = path
        self.handle = handle
        self.identity = identity
    }

    package var fd: Int32 { handle.fd }

    package func named(_ name: String) throws -> stat? {
        guard safeComponent(name) else { throw FileRefusal.invalid }
        var result = stat()
        if fstatat(fd, name, &result, AT_SYMLINK_NOFOLLOW) == 0 { return result }
        if errno == ENOENT { return nil }
        throw FileRefusal.system(errno)
    }

    package func child(_ name: String) throws -> Directory {
        guard let known = try named(name), fileKind(known, S_IFDIR) else {
            throw FileRefusal.invalid
        }
        let opened = try OwnedDescriptor(openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC))
        let observed = try opened.metadata()
        let identity = FileIdentity(observed)
        guard identity == FileIdentity(known),
              try named(name).map(FileIdentity.init) == identity else { throw FileRefusal.invalid }
        return Directory(path: path == "/" ? "/" + name : path + "/" + name, handle: opened, identity: identity)
    }

    package func requireOwnedDirectory(privateMode: Bool = false) throws {
        let metadata = try handle.metadata()
        guard fileKind(metadata, S_IFDIR), metadata.st_uid == geteuid(),
              metadata.st_mode & mode_t(privateMode ? 0o077 : 0o022) == 0 else {
            throw FileRefusal.invalid
        }
    }

    package func createDirectory(_ name: String) throws -> Directory {
        guard safeComponent(name) else { throw FileRefusal.invalid }
        guard mkdirat(fd, name, 0o700) == 0 else { throw FileRefusal.system(errno) }
        let result = try child(name)
        try result.requireOwnedDirectory(privateMode: true)
        return result
    }

    package func ensureDirectory(_ name: String) throws -> Directory {
        if try named(name) == nil {
            do {
                return try createDirectory(name)
            } catch FileRefusal.system(let code) where code == EEXIST {
                // A cooperating creator won. Validate the actual directory below.
            }
        }
        let result = try child(name)
        try result.requireOwnedDirectory()
        return result
    }

    package func openRegular(
        _ name: String, write: Bool = false, privateMode: Bool = false
    ) throws -> OwnedDescriptor {
        guard let before = try named(name), isOwnedFile(before, privateMode: privateMode) else {
            throw FileRefusal.invalid
        }
        let opened = try OwnedDescriptor(openat(
            fd, name, (write ? O_RDWR : O_RDONLY) | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
        ))
        let actual = try opened.metadata()
        guard isOwnedFile(actual, privateMode: privateMode),
              FileIdentity(before) == FileIdentity(actual) else { throw FileRefusal.invalid }
        try match(name, opened, privateMode: privateMode)
        return opened
    }

    package func match(_ name: String, _ opened: OwnedDescriptor, privateMode: Bool) throws {
        let actual = try opened.metadata()
        guard let current = try named(name), isOwnedFile(current, privateMode: privateMode),
              isOwnedFile(actual, privateMode: privateMode),
              FileIdentity(current) == FileIdentity(actual) else { throw FileRefusal.invalid }
    }

    package func requireAnchored() throws {
        guard try Directory(path: path).identity == identity else { throw FileRefusal.invalid }
    }

    package func createFile(_ name: String, mode: mode_t = 0o600) throws -> OwnedDescriptor {
        guard safeComponent(name) else { throw FileRefusal.invalid }
        return try OwnedDescriptor(openat(
            fd, name, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, mode
        ))
    }

    package func names() throws -> Set<String> {
        let owned = openat(fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard owned >= 0 else { throw FileRefusal.system(errno) }
        guard let stream = fdopendir(owned) else {
            let problem = errno
            _ = close(owned)
            throw FileRefusal.system(problem)
        }
        defer { _ = closedir(stream) }
        var names = Set<String>()
        while true {
            errno = 0
            guard let entry = readdir(stream) else {
                if errno != 0 { throw FileRefusal.system(errno) }
                return names
            }
            let bytes = withUnsafeBytes(of: entry.pointee.d_name) {
                Array($0.prefix(while: { $0 != 0 }))
            }
            guard let name = String(bytes: bytes, encoding: .utf8) else {
                throw FileRefusal.invalid
            }
            if name != "." && name != ".." {
                guard names.insert(name).inserted else { throw FileRefusal.invalid }
            }
        }
    }
}

package func readBounded(_ handle: OwnedDescriptor, maximum: Int) throws -> Data {
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 16_384)
    while data.count <= maximum {
        let remaining = min(buffer.count, maximum + 1 - data.count)
        let count = buffer.withUnsafeMutableBytes { read(handle.fd, $0.baseAddress, remaining) }
        if count == 0 { return data }
        if count < 0 {
            if errno == EINTR { continue }
            throw FileRefusal.system(errno)
        }
        data.append(contentsOf: buffer.prefix(count))
    }
    throw FileRefusal.invalid
}

package func writeAll(_ handle: OwnedDescriptor, _ data: Data) throws {
    try data.withUnsafeBytes { bytes in
        var offset = 0
        while offset < bytes.count {
            let count = write(handle.fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw FileRefusal.system(errno) }
            offset += count
        }
    }
}

package func fileSHA256(_ handle: OwnedDescriptor, cap: Int = 64 * 1024 * 1024) throws -> String {
    let before = try handle.metadata()
    guard before.st_size >= 0 && before.st_size <= cap else { throw FileRefusal.invalid }
    var digest = SHA256()
    var total = 0
    var buffer = [UInt8](repeating: 0, count: 32_768)
    while true {
        let count = buffer.withUnsafeMutableBytes { read(handle.fd, $0.baseAddress, $0.count) }
        if count == 0 { break }
        if count < 0 {
            if errno == EINTR { continue }
            throw FileRefusal.system(errno)
        }
        total += count
        guard total <= cap else { throw FileRefusal.invalid }
        digest.update(data: Data(buffer.prefix(count)))
    }
    let after = try handle.metadata()
    guard total == before.st_size, before.st_size == after.st_size,
          before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
          before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec else {
        throw FileRefusal.invalid
    }
    return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

package func asciiHex(_ value: String, count: Int) -> Bool {
    value.utf8.count == count && value.utf8.allSatisfy {
        (48...57).contains($0) || (97...102).contains($0)
    }
}
