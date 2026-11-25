import Darwin
@testable import LauncherEngine
import Testing

@Suite struct ACLTests {
    private final class Cursor {
        var calls: [String] = []
        var presence: Int32 = 32
        var propertyResult: Int32 = 0
        var decoded = true
        var allocation = true
        var permitMount = true
        var support = 1
        var valid = true
        var nilEntry = false
        var stopError = EINVAL
        var tagResult: Int32 = 0
        var tags: [acl_tag_t] = []
        var index = 0

        var operations: ACLCalls {
            let record = OpaquePointer(bitPattern: 1)!
            let list = OpaquePointer(bitPattern: 2)!
            let entry = OpaquePointer(bitPattern: 3)!
            return ACLCalls(
                allocate: { self.calls.append("allocate"); return self.allocation ? record : nil },
                dispose: { _ in self.calls.append("dispose") },
                inspect: { _, _ in
                    self.calls.append("inspect")
                    if !self.permitMount { throw FileRefusal.invalid }
                },
                support: { _ in self.calls.append("support"); return self.support },
                property: { _ in self.calls.append("query"); return (self.propertyResult, self.presence) },
                decode: { _ in
                    self.calls.append("decode")
                    return (0, self.decoded ? list : nil)
                },
                validate: { _ in self.calls.append("validate"); return self.valid ? 0 : -1 },
                free: { _ in self.calls.append("free") },
                entry: { _, first in
                    self.calls.append(first ? "first" : "next")
                    if self.index >= self.tags.count { return (-1, self.stopError, nil) }
                    self.index += 1
                    return (0, 0, self.nilEntry ? nil : entry)
                },
                tag: { _ in self.calls.append("tag"); return (self.tagResult, self.tags[self.index - 1]) }
            )
        }
    }

    @Test func zeroMeansAbsentAndNonzeroMeansPresent() throws {
        let absent = Cursor()
        absent.presence = 0
        #expect(try classifyACL(9, calls: absent.operations) == .absent)
        #expect(absent.calls == ["allocate", "inspect", "support", "query", "dispose"])
        for value: Int32 in [1, 32] {
            let empty = Cursor()
            empty.presence = value
            #expect(try classifyACL(9, calls: empty.operations) == .empty)
            #expect(empty.calls == ["allocate", "inspect", "support", "query", "decode",
                                    "validate", "first", "free", "dispose"])
        }
    }

    @Test func boundedDenyOnlyAndAllowPolicies() throws {
        let maximum = Cursor()
        maximum.tags = Array(repeating: ACL_EXTENDED_DENY, count: Int(ACL_MAX_ENTRIES))
        #expect(try classifyACL(9, calls: maximum.operations) == .denyOnly)
        #expect(maximum.calls.filter { $0 == "tag" }.count == Int(ACL_MAX_ENTRIES))
        #expect(maximum.calls.suffix(3).elementsEqual(["next", "free", "dispose"]))
        let excessive = Cursor()
        excessive.tags = Array(repeating: ACL_EXTENDED_DENY, count: Int(ACL_MAX_ENTRIES) + 1)
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: excessive.operations) }
        #expect(excessive.calls.suffix(2).elementsEqual(["free", "dispose"]))
        let allow = Cursor()
        allow.tags = [ACL_EXTENDED_DENY, ACL_EXTENDED_ALLOW]
        #expect(try classifyACL(9, calls: allow.operations) == .allowsAccess)
    }

    @Test func failuresDoNotBecomeAbsentOrEmpty() {
        let unavailable = Cursor()
        unavailable.allocation = false
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: unavailable.operations) }
        #expect(unavailable.calls == ["allocate"])
        let noMount = Cursor()
        noMount.permitMount = false
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: noMount.operations) }
        #expect(noMount.calls == ["allocate", "inspect", "dispose"])
        let noSupport = Cursor()
        noSupport.support = 0
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: noSupport.operations) }
        #expect(!noSupport.calls.contains("query"))
        let failedQuery = Cursor()
        failedQuery.propertyResult = -1
        failedQuery.presence = 0
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: failedQuery.operations) }
        #expect(!failedQuery.calls.contains("decode"))
        let failedDecode = Cursor()
        failedDecode.decoded = false
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: failedDecode.operations) }
        #expect(!failedDecode.calls.contains("validate"))
        let invalid = Cursor()
        invalid.valid = false
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: invalid.operations) }
        #expect(invalid.calls.suffix(3).elementsEqual(["validate", "free", "dispose"]))
        let missing = Cursor()
        missing.tags = [ACL_EXTENDED_DENY]
        missing.nilEntry = true
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: missing.operations) }
        #expect(!missing.calls.contains("tag"))
        let invalidEnd = Cursor()
        invalidEnd.tags = [ACL_EXTENDED_DENY]
        invalidEnd.stopError = EIO
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: invalidEnd.operations) }
        let invalidTag = Cursor()
        invalidTag.tags = [ACL_EXTENDED_DENY]
        invalidTag.tagResult = -1
        #expect(throws: FileRefusal.self) { try classifyACL(9, calls: invalidTag.operations) }
        #expect(invalidTag.calls.suffix(3).elementsEqual(["tag", "free", "dispose"]))
    }
}
