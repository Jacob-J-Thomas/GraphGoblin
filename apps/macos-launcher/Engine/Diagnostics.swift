import Darwin
import Foundation

enum ACLClassification: Equatable {
    case absent, empty, denyOnly, allowsAccess
}

struct ACLCalls {
    var allocate: () -> filesec_t?
    var dispose: (filesec_t) -> Void
    var inspect: (Int32, filesec_t) throws -> Void
    var support: (Int32) -> Int
    var property: (filesec_t) -> (status: Int32, present: Int32)
    var decode: (filesec_t) -> (status: Int32, handle: acl_t?)
    var validate: (acl_t) -> Int32
    var free: (acl_t) -> Void
    var entry: (acl_t, Bool) -> (status: Int32, error: Int32, entry: acl_entry_t?)
    var tag: (acl_entry_t) -> (status: Int32, tag: acl_tag_t)

    static var native: ACLCalls {
        ACLCalls(
            allocate: { filesec_init() },
            dispose: { filesec_free($0) },
            inspect: { fd, filesec in
                var metadata = stat()
                errno = 0
                guard fstatx_np(fd, &metadata, filesec) == 0 else {
                    throw FileRefusal.system(errno)
                }
                var mount = statfs()
                errno = 0
                guard fstatfs(fd, &mount) == 0 else { throw FileRefusal.system(errno) }
                let type = withUnsafeBytes(of: mount.f_fstypename) {
                    String(decoding: $0.prefix(while: { $0 != 0 }), as: UTF8.self)
                }
                guard type == "apfs", mount.f_flags & UInt32(MNT_LOCAL) != 0,
                      mount.f_flags & UInt32(MNT_IGNORE_OWNERSHIP) == 0 else {
                    throw FileRefusal.invalid
                }
            },
            support: {
                errno = 0
                return fpathconf($0, Int32(_PC_EXTENDED_SECURITY_NP))
            },
            property: {
                var present: Int32 = 0
                errno = 0
                return (filesec_query_property($0, FILESEC_ACL, &present), present)
            },
            decode: {
                var handle: acl_t?
                errno = 0
                return (filesec_get_property($0, FILESEC_ACL, &handle), handle)
            },
            validate: {
                errno = 0
                return acl_valid($0)
            },
            free: { _ = acl_free(UnsafeMutableRawPointer($0)) },
            entry: { list, first in
                var value: acl_entry_t?
                errno = 0
                let entryID = first ? ACL_FIRST_ENTRY : ACL_NEXT_ENTRY
                let result = acl_get_entry(list, Int32(entryID.rawValue), &value)
                return (result, errno, value)
            },
            tag: {
                var tag = ACL_EXTENDED_DENY
                errno = 0
                return (acl_get_tag_type($0, &tag), tag)
            }
        )
    }
}

func classifyACL(_ fd: Int32, calls: ACLCalls = .native) throws -> ACLClassification {
    guard let security = calls.allocate() else { throw FileRefusal.invalid }
    defer { calls.dispose(security) }
    try calls.inspect(fd, security)
    guard calls.support(fd) > 0 else { throw FileRefusal.invalid }
    let property = calls.property(security)
    guard property.status == 0 else { throw FileRefusal.invalid }
    if property.present == 0 { return .absent }
    let decoded = calls.decode(security)
    guard decoded.status == 0, let acl = decoded.handle else { throw FileRefusal.invalid }
    defer { calls.free(acl) }
    guard calls.validate(acl) == 0 else { throw FileRefusal.invalid }
    var hasAllow = false
    let maximum = Int(ACL_MAX_ENTRIES)
    for index in 0...maximum {
        let next = calls.entry(acl, index == 0)
        if next.status == -1 && next.error == EINVAL {
            if index == 0 { return .empty }
            return hasAllow ? .allowsAccess : .denyOnly
        }
        guard index < maximum, next.status == 0, let entry = next.entry else {
            throw FileRefusal.invalid
        }
        let tagged = calls.tag(entry)
        guard tagged.status == 0 else { throw FileRefusal.invalid }
        switch tagged.tag {
        case ACL_EXTENDED_ALLOW: hasAllow = true
        case ACL_EXTENDED_DENY: break
        default: throw FileRefusal.invalid
        }
    }
    throw FileRefusal.invalid
}

package func requireSafeACL(_ file: OwnedDescriptor, ancestor: Bool) throws {
    switch try classifyACL(file.fd) {
    case .absent, .empty: return
    case .denyOnly where ancestor: return
    case .denyOnly, .allowsAccess: throw FileRefusal.invalid
    }
}

struct LogDirectory: Sendable {
    let parent: Directory
    let root: Directory

    static func open(for installation: VerifiedInstallation, create: Bool) throws -> LogDirectory {
        var current = try Directory(path: installation.home)
        try validateDirectory(current, ancestor: true)
        for name in ["Library", "Logs", "GraphGoblin"] {
            current = try create ? current.ensureDirectory(name) : current.child(name)
            try validateDirectory(current, ancestor: true)
        }
        let name: String
        if installation.name == AppName.standard {
            name = "Launcher"
        } else {
            current = try create ? current.ensureDirectory("LauncherInstances") : current.child("LauncherInstances")
            try validateDirectory(current, ancestor: true)
            name = installation.contents.id
        }
        let root = try create ? current.ensureDirectory(name) : current.child(name)
        try validateDirectory(root, ancestor: false)
        return LogDirectory(parent: current, root: root)
    }

    private static func validateDirectory(_ directory: Directory, ancestor: Bool) throws {
        try directory.requireOwnedDirectory(privateMode: !ancestor)
        try requireSafeACL(directory.handle, ancestor: ancestor)
        try directory.requireAnchored()
        guard access(directory.path, X_OK) == 0 else { throw FileRefusal.system(errno) }
    }

    func gatewayAdmission() throws -> String {
        try Self.validateDirectory(root, ancestor: false)
        guard access(root.path, W_OK | X_OK) == 0 else { throw FileRefusal.system(errno) }
        for name in ["gateway.log", "gateway.log.1"] {
            _ = try slot(name, writable: false)
        }
        return try admissionDocument(path: root.path, identity: root.identity)
    }

    private func slot(_ name: String, writable: Bool) throws -> OwnedDescriptor? {
        guard try root.named(name) != nil else { return nil }
        let file = try root.openRegular(name, write: writable, privateMode: true)
        try validateSlot(name, file)
        return file
    }

    private func validateSlot(_ name: String, _ file: OwnedDescriptor) throws {
        guard FileIdentity(try file.metadata()).device == root.identity.device else {
            throw FileRefusal.invalid
        }
        try requireSafeACL(file, ancestor: false)
        try root.match(name, file, privateMode: true)
    }

    func appendLauncherRecord(_ record: Data) throws {
        guard record.count <= 4_096 else { throw FileRefusal.invalid }
        // Open independently so this serialization never shares the gateway's root lock.
        let lock = try OwnedDescriptor(open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC))
        guard FileIdentity(try lock.metadata()) == parent.identity, flock(lock.fd, LOCK_EX | LOCK_NB) == 0
        else { throw FileRefusal.invalid }
        defer { _ = flock(lock.fd, LOCK_UN) }
        try Self.validateDirectory(parent, ancestor: true)
        try Self.validateDirectory(root, ancestor: false)
        let activeName = "launcher.log"
        let previousName = "launcher.log.1"
        let oldActive = try slot(activeName, writable: true)
        let oldPrevious = try slot(previousName, writable: true)
        if let oldPrevious { _ = try repair(previousName, oldPrevious) }
        let active: OwnedDescriptor
        var boundary = 0
        if let oldActive {
            boundary = try repair(activeName, oldActive)
            if boundary + record.count > Self.nativeCap {
                try root.requireAnchored()
                try validateSlot(activeName, oldActive)
                if let oldPrevious {
                    try validateSlot(previousName, oldPrevious)
                } else {
                    guard try root.named(previousName) == nil else { throw FileRefusal.invalid }
                }
                guard renameat(root.fd, activeName, root.fd, previousName) == 0 else {
                    throw FileRefusal.system(errno)
                }
                active = try createSlot(activeName)
                boundary = 0
            } else {
                active = oldActive
            }
        } else {
            active = try createSlot(activeName)
        }
        try root.requireAnchored()
        try validateSlot(activeName, active)
        guard lseek(active.fd, off_t(boundary), SEEK_SET) == off_t(boundary) else {
            throw FileRefusal.system(errno)
        }
        do {
            try writeAll(active, record)
        } catch {
            try root.requireAnchored()
            try validateSlot(activeName, active)
            _ = ftruncate(active.fd, off_t(boundary))
            throw error
        }
    }

    private static let nativeCap = 262_144

    private func createSlot(_ name: String) throws -> OwnedDescriptor {
        try root.requireAnchored()
        let file = try root.createFile(name)
        try validateSlot(name, file)
        return file
    }

    private func repair(_ name: String, _ file: OwnedDescriptor) throws -> Int {
        let reference = try file.metadata().st_size
        guard reference >= 0 else { throw FileRefusal.invalid }
        let count = Int(min(reference, off_t(Self.nativeCap)))
        var bytes = [UInt8](repeating: 0, count: count)
        var offset = 0
        try bytes.withUnsafeMutableBytes { buffer in
            while offset < buffer.count {
                let read = pread(file.fd, buffer.baseAddress!.advanced(by: offset),
                                 buffer.count - offset, off_t(offset))
                if read < 0 && errno == EINTR { continue }
                guard read > 0 else { throw FileRefusal.invalid }
                offset += read
            }
        }
        var end = 0
        for index in bytes.indices where bytes[index] == 10 {
            guard index - end + 1 <= 4_096, String(bytes: bytes[end..<index], encoding: .utf8) != nil
            else { break }
            end = index + 1
        }
        if reference != off_t(end) {
            try root.requireAnchored()
            try validateSlot(name, file)
            guard ftruncate(file.fd, off_t(end)) == 0 else { throw FileRefusal.system(errno) }
        }
        return end
    }
}

func admissionDocument(path: String, identity: FileIdentity) throws -> String {
    guard identity.isCanonical else { throw FileRefusal.invalid }
    let document = try JSONSerialization.data(withJSONObject: [
        "version": 1, "root": path, "device": identity.device, "inode": identity.inode
    ], options: [.sortedKeys, .withoutEscapingSlashes])
    guard document.count <= 4_096, let text = String(data: document, encoding: .utf8) else {
        throw FileRefusal.invalid
    }
    return text
}
