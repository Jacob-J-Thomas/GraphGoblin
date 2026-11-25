import Darwin
import Foundation
@testable import LauncherEngine
@testable import LauncherInstaller
import Testing

/// The installer's destination-versus-input comparison. Missing components keep the caller's
/// spelling, so the comparison must use the actual volume's name semantics, not lexical prefixes.
/// Case-sensitive behavior is exercised through the narrow semantics seam: no case-sensitive volume
/// is created or assumed here. The actual volume is only consulted where the expectation follows it.
@Suite struct ProspectiveOverlapTests {
    private final class Semantics {
        let sensitive: Bool?
        var consulted: [FileIdentity] = []

        init(sensitive: Bool?) { self.sensitive = sensitive }

        func answer(_ directory: Directory) throws -> Bool {
            consulted.append(directory.identity)
            guard let sensitive else { throw FileRefusal.system(EINVAL) }
            return sensitive
        }
    }

    private func scratch(_ run: (Directory) throws -> Void) throws {
        let tmp = try canonicalPath(FileManager.default.temporaryDirectory.path)
        let root = try Directory(path: tmp).createDirectory("graphgoblin-overlap-test-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(atPath: root.path) }
        try run(root)
    }

    @Test func freshAlternateCaseSelfAndDescendantOverlapOnInsensitiveNames() throws {
        try scratch { (root: Directory) throws in
            let target = root.path + "/GraphGoblin IDE.app"
            let aliases = [
                root.path + "/graphgoblin ide.app",
                root.path + "/GRAPHGOBLIN IDE.APP/store",
                root.path + "/graphGoblin Ide.app/nested/deeper"
            ]
            for alias in aliases {
                let semantics = Semantics(sensitive: false)
                #expect(try LauncherInstaller.overlapping(target, alias, caseSensitive: semantics.answer), "\(alias)")
                #expect(try LauncherInstaller.overlapping(alias, target, caseSensitive: semantics.answer), "\(alias)")
                // Only the existing shared parent decides, once per direction.
                #expect(semantics.consulted == [root.identity, root.identity])
            }
            let insensitive = Semantics(sensitive: false)
            for sibling in [
                root.path + "/graphgoblin ide.app data", root.path + "/GraphGoblin IDE.apps",
                root.path + "/GraphGoblin IDE", root.path + "/Other.app/GraphGoblin IDE.app"
            ] {
                #expect(try !LauncherInstaller.overlapping(target, sibling, caseSensitive: insensitive.answer),
                        "\(sibling)")
            }
            let untouched = Semantics(sensitive: nil)
            for related in [target, target + "/inside", root.path, "/"] {
                #expect(try LauncherInstaller.overlapping(target, related, caseSensitive: untouched.answer),
                        "\(related)")
            }
            #expect(untouched.consulted.isEmpty)
            #expect(try root.names().isEmpty)
        }
    }

    @Test func caseSensitiveNamesKeepDistinctSiblingsDistinct() throws {
        try scratch { (root: Directory) throws in
            let target = root.path + "/GraphGoblin QA.app"
            let semantics = Semantics(sensitive: true)
            for sibling in [root.path + "/graphgoblin qa.app", root.path + "/GRAPHGOBLIN QA.APP/store"] {
                #expect(try !LauncherInstaller.overlapping(target, sibling, caseSensitive: semantics.answer),
                        "\(sibling)")
            }
            #expect(semantics.consulted == [root.identity, root.identity])
            #expect(try LauncherInstaller.overlapping(target, target + "/store", caseSensitive: semantics.answer))
            // Canonically equivalent spellings name one entry on normalization-insensitive volumes.
            let composed = root.path + "/GraphGoblin QA \u{00E1}.app"
            let decomposed = root.path + "/GraphGoblin QA a\u{0301}.app/store"
            #expect(try LauncherInstaller.overlapping(composed, decomposed, caseSensitive: semantics.answer))
            #expect(semantics.consulted.count == 2)
        }
    }

    @Test func existingEntriesAreComparedByIdentityBeforeNameSemantics() throws {
        try scratch { (root: Directory) throws in
            _ = try root.createDirectory("Existing")
            _ = try root.createDirectory("Other")
            let actual = try LauncherInstaller.caseSensitiveNames(root)
            for claimed in [true, false] {
                let semantics = Semantics(sensitive: claimed)
                #expect(try !LauncherInstaller.overlapping(
                    root.path + "/Existing/store", root.path + "/Other/store", caseSensitive: semantics.answer
                ))
                // One existing entry and one the volume cannot find are distinct under its own semantics.
                #expect(try !LauncherInstaller.overlapping(
                    root.path + "/Existing/store", root.path + "/Missing/store", caseSensitive: semantics.answer
                ))
                // The volume's own lookup of the alternate spelling decides, whatever the seam claims.
                #expect(try LauncherInstaller.overlapping(
                    root.path + "/Existing", root.path + "/existing/store", caseSensitive: semantics.answer
                ) == !actual)
                #expect(semantics.consulted.isEmpty)
            }
        }
    }

    @Test func missingParentsUseTheNearestExistingAncestor() throws {
        try scratch { (root: Directory) throws in
            let target = root.path + "/missing/deeper/Target.app"
            let alias = root.path + "/missing/deeper/target.app/store"
            let insensitive = Semantics(sensitive: false)
            #expect(try LauncherInstaller.overlapping(target, alias, caseSensitive: insensitive.answer))
            #expect(insensitive.consulted == [root.identity])
            let sensitive = Semantics(sensitive: true)
            #expect(try !LauncherInstaller.overlapping(target, alias, caseSensitive: sensitive.answer))
            #expect(sensitive.consulted == [root.identity])
            #expect(try root.names().isEmpty)
        }
    }

    @Test func actualVolumeSemanticsDecideAFreshAlternateSpelling() throws {
        try scratch { (root: Directory) throws in
            let sensitive = try LauncherInstaller.caseSensitiveNames(root)
            let target = root.path + "/Fresh.app"
            #expect(try LauncherInstaller.overlapping(target, root.path + "/fresh.app/store") == !sensitive)
            #expect(try LauncherInstaller.overlapping(target, root.path + "/FRESH.APP") == !sensitive)
            #expect(try !LauncherInstaller.overlapping(target, root.path + "/fresh.app.store"))
            #expect(try root.names().isEmpty)
        }
    }

    @Test func unknownNameSemanticsRefuseInsteadOfAdmitting() throws {
        try scratch { (root: Directory) throws in
            let unknown = Semantics(sensitive: nil)
            #expect(throws: FileRefusal.self) {
                try LauncherInstaller.overlapping(root.path + "/Target.app", root.path + "/target.app",
                                                  caseSensitive: unknown.answer)
            }
            #expect(unknown.consulted == [root.identity])
            let plain = try root.createFile("plain")
            try writeAll(plain, Data("not a directory".utf8))
            let unused = Semantics(sensitive: false)
            #expect(throws: FileRefusal.self) {
                try LauncherInstaller.overlapping(root.path + "/plain/Target.app", root.path + "/plain/target.app",
                                                  caseSensitive: unused.answer)
            }
            #expect(unused.consulted.isEmpty)
            for (a, b) in [(root.path + "/a/../b", root.path + "/b"), ("relative", root.path),
                           (root.path, root.path + "/./x")] {
                #expect(throws: FileRefusal.self) {
                    try LauncherInstaller.overlapping(a, b, caseSensitive: unused.answer)
                }
            }
            #expect(try LauncherInstaller.caseSensitivity(1))
            #expect(try !LauncherInstaller.caseSensitivity(0))
            for answer in [-1, 2] {
                #expect(throws: FileRefusal.self) { try LauncherInstaller.caseSensitivity(answer) }
            }
        }
    }
}
