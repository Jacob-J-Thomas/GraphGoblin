import Darwin
import Foundation

struct Refusal: Error, CustomStringConvertible {
    let description: String
}

func require(_ okay: Bool, _ reason: String) throws {
    guard okay else { throw Refusal(description: reason) }
}

func emit(_ object: [String: Any]) throws {
    var bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    bytes.append(10)
    FileHandle.standardOutput.write(bytes)
}

func canonical(_ path: String) throws -> String {
    guard let buffer = realpath(path, nil) else { throw Refusal(description: "realpath: \(errno)") }
    defer { free(buffer) }
    return String(cString: buffer)
}

func workspace() throws -> String {
    guard let account = getpwuid(geteuid()) else { throw Refusal(description: "missing account") }
    let home = try canonical(String(cString: account.pointee.pw_dir))
    let root = FileManager.default.currentDirectoryPath
    let leaf = URL(fileURLWithPath: root).lastPathComponent
    try require(getuid() == geteuid() && geteuid() != 0 && root.hasPrefix(home + "/"), "workspace account")
    let rootPath = try canonical(root)
    try require(rootPath == root && leaf.range(of: "^gg456-logcap-[a-f0-9]{32}$", options: .regularExpression) != nil,
        "workspace path")
    var metadata = stat()
    try require(lstat(root, &metadata) == 0 && metadata.st_uid == geteuid()
        && metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
        && metadata.st_mode & 0o7777 == 0o700, "workspace owner, type or mode")
    return root
}

func fixturePath(_ root: String, _ relative: String) throws -> String {
    let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
    try require((2...4).contains(parts.count) && ["locks", "acl"].contains(String(parts[0]))
        && relative.utf8.count <= 100 && parts.allSatisfy { part in
            !part.isEmpty && part != "." && part != ".." && part.utf8.allSatisfy { byte in
                (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
                    || byte == 45 || byte == 95 || byte >= 128
            }
        }, "fixture names only")
    let path = root + "/" + relative
    let parent = (path as NSString).deletingLastPathComponent
    let physicalParent = try canonical(parent)
    try require(physicalParent == parent && parent.hasPrefix(root + "/"), "fixture parent")
    return path
}

func identity(_ metadata: stat) -> [String: Any] {
    let kind = metadata.st_mode & mode_t(S_IFMT)
    return [
        "dev": String(UInt64(bitPattern: Int64(metadata.st_dev))),
        "ino": String(metadata.st_ino),
        "uid": metadata.st_uid,
        "mode": Int(metadata.st_mode & 0o7777),
        "nlink": String(metadata.st_nlink),
        "kind": kind == mode_t(S_IFDIR) ? "directory" : kind == mode_t(S_IFREG) ? "file"
            : kind == mode_t(S_IFLNK) ? "symlink" : "other",
    ]
}

func detail(_ operation: String, _ status: Int32) -> [String: Any] {
    ["state": "query-error", "operation": operation, "errno": status]
}

func descriptorSecurity(_ fd: Int32) throws -> [String: Any] {
    guard let security = filesec_init() else { return detail("filesec_init", errno) }
    defer { filesec_free(security) }
    var opened = stat()
    let inspected = fstatx_np(fd, &opened, security)
    let statError = errno
    if inspected != 0 { return detail("fstatx_np", statError) }
    var mounts = statfs()
    let mountResult = fstatfs(fd, &mounts)
    let mountError = errno
    if mountResult != 0 { return detail("fstatfs", mountError) }
    let fileSystem = withUnsafeBytes(of: mounts.f_fstypename) {
        String(decoding: $0.prefix(while: { $0 != 0 }), as: UTF8.self)
    }
    errno = 0
    let capacity = fpathconf(fd, Int32(_PC_EXTENDED_SECURITY_NP))
    let capacityError = errno
    var aclPresent: Int32 = 0
    let discovered = filesec_query_property(security, FILESEC_ACL, &aclPresent)
    let propertyError = errno
    var result: [String: Any] = [
        "state": "opened", "opened": identity(opened), "fs": fileSystem,
        "mountFlags": String(mounts.f_flags), "local": mounts.f_flags & UInt32(MNT_LOCAL) != 0,
        "enforcesOwnership": mounts.f_flags & UInt32(MNT_IGNORE_OWNERSHIP) == 0,
        "aclCapability": capacity, "aclCapabilityErrno": capacityError,
        "aclPropertyStatus": discovered, "aclPropertyPresent": aclPresent,
    ]
    if capacity <= 0 || discovered != 0 {
        result["acl"] = detail(capacity <= 0 ? "fpathconf" : "filesec_query_property",
            capacity <= 0 ? capacityError : propertyError)
        return result
    }
    if aclPresent == 0 {
        result["acl"] = ["state": "absent"]
        return result
    }
    var acl: acl_t?
    let decoded = filesec_get_property(security, FILESEC_ACL, &acl)
    let decodedError = errno
    guard decoded == 0, let list = acl else {
        result["acl"] = detail("filesec_get_property", decodedError)
        return result
    }
    defer { _ = acl_free(UnsafeMutableRawPointer(list)) }
    var entries: [String] = []
    var entry: acl_entry_t?
    for index in 0..<16 {
        errno = 0
        let entryID = index == 0 ? ACL_FIRST_ENTRY : ACL_NEXT_ENTRY
        let next = acl_get_entry(list, Int32(entryID.rawValue), &entry)
        let nextError = errno
        if next != 0 {
            if nextError == EINVAL {
                result["acl"] = ["state": entries.isEmpty ? "empty" : "present", "entries": entries]
            } else {
                result["acl"] = detail("acl_get_entry", nextError)
            }
            return result
        }
        guard let entry else { throw Refusal(description: "missing ACL entry") }
        var tag = ACL_EXTENDED_DENY
        let tagged = acl_get_tag_type(entry, &tag)
        let tagError = errno
        if tagged != 0 {
            result["acl"] = detail("acl_get_tag_type", tagError)
            return result
        }
        entries.append(tag == ACL_EXTENDED_ALLOW ? "allow" : tag == ACL_EXTENDED_DENY ? "deny" : "unknown")
    }
    result["acl"] = ["state": "entry-limit"]
    return result
}

func inspect(_ path: String) throws {
    var named = stat()
    guard lstat(path, &named) == 0 else {
        let status = errno
        try emit(["state": "missing-or-inaccessible", "errno": status])
        return
    }
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
    let status = errno
    guard fd >= 0 else {
        try emit(["state": "open-refused", "errno": status, "named": identity(named)])
        return
    }
    defer { _ = close(fd) }
    if named.st_uid != geteuid() { throw Refusal(description: "foreign fixture name") }
    var output = try descriptorSecurity(fd)
    output["named"] = identity(named)
    try emit(output)
}

func hold(_ root: String, _ path: String) throws {
    let physical = try canonical(path)
    try require(physical.hasPrefix(root + "/locks/"), "lock target")
    let fd = open(physical, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw Refusal(description: "lock directory open: \(errno)") }
    defer { _ = close(fd) }
    var opened = stat()
    try require(fstat(fd, &opened) == 0 && opened.st_uid == geteuid(), "lock descriptor metadata")
    errno = 0
    let locked = flock(fd, LOCK_EX | LOCK_NB)
    let status = errno
    try emit(["state": locked == 0 ? "locked" : "refused", "errno": status,
        "descriptor": fd, "pid": getpid(), "opened": identity(opened)])
    guard locked == 0 else { return }
    // Only the controller owns this input. EOF or expiry releases the owned open description.
    var input = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
    let waited = poll(&input, 1, 12_000)
    let waitError = errno
    try require(waited > 0, "lock release not observed: \(waited)/\(waitError)")
}

// Retain the previously qualified libproc birth and exact executable readback.
func birthRecord(_ pid: pid_t) throws -> proc_bsdinfo? {
    var info = proc_bsdinfo()
    let bytes = Int32(MemoryLayout<proc_bsdinfo>.size)
    errno = 0
    let found = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, bytes)
    let status = errno
    if found == 0 && status == ESRCH { return nil }
    try require(found == bytes && info.pbi_pid == UInt32(pid) && info.pbi_start_tvsec > 0,
        "unverified process birth: \(found)/\(status)")
    return info
}

func birth(_ pid: pid_t) throws {
    guard let original = try birthRecord(pid) else { try emit(["pid": pid, "state": "absent"]); return }
    try require(original.pbi_uid == geteuid(), "process owner")
    var image = [CChar](repeating: 0, count: Int(MAXPATHLEN) * 4)
    let capacity = UInt32(image.count)
    let length = image.withUnsafeMutableBufferPointer { proc_pidpath(pid, $0.baseAddress, capacity) }
    guard let confirmed = try birthRecord(pid) else { try emit(["pid": pid, "state": "absent"]); return }
    let created = "\(confirmed.pbi_start_tvsec):\(confirmed.pbi_start_tvusec)"
    try require(confirmed.pbi_start_tvsec == original.pbi_start_tvsec
        && confirmed.pbi_start_tvusec == original.pbi_start_tvusec, "process birth changed during inspection")
    if length <= 0 {
        try emit(["pid": pid, "state": "unverified", "birth": created])
        return
    }
    let executable = try image.withUnsafeBufferPointer { try canonical(String(cString: $0.baseAddress!)) }
    try emit(["pid": pid, "state": "live", "uid": confirmed.pbi_uid, "ppid": confirmed.pbi_ppid,
        "birth": created, "executable": executable])
}

do {
    let root = try workspace()
    let args = Array(CommandLine.arguments.dropFirst())
    switch args.first {
    case "flags" where args.count == 1:
        try emit(["exlock": O_EXLOCK, "nonblock": O_NONBLOCK, "readonly": O_RDONLY,
            "directory": O_DIRECTORY, "nofollow": O_NOFOLLOW, "contentionErrno": EWOULDBLOCK,
            "uid": geteuid(), "widthCanary": String(UInt64.max)])
    case "inspect" where args.count == 2:
        try inspect(fixturePath(root, args[1]))
    case "bad-fd" where args.count == 1:
        try emit(descriptorSecurity(-1))
    case "lock" where args.count == 2:
        try hold(root, fixturePath(root, args[1]))
    case "birth" where args.count == 2:
        guard let pid = pid_t(args[1]), pid > 1 else { throw Refusal(description: "invalid fixture PID") }
        try birth(pid)
    default:
        throw Refusal(description: "unknown fixture command")
    }
} catch {
    FileHandle.standardError.write(Data((String(describing: error) + "\n").utf8))
    exit(1)
}
