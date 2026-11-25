import Darwin
import Foundation
import LauncherEngine

enum PublishDisposition: Equatable {
    case published
    case previousInstallVerified
    case targetAbsentVerified
    case recoveryRequired
}

struct BundlePublisher {
    let applications: Directory
    let stage: Directory
    let name: String
    let previous: BundleWitness?
    let candidate: BundleWitness

    func publish(acceptReadback: () -> Bool = { true }) -> PublishDisposition {
        do {
            try checkPlacement()
            let flags = previous == nil ? UInt32(RENAME_EXCL) : UInt32(RENAME_SWAP)
            if renameatx_np(stage.fd, name, applications.fd, name, flags) != 0 {
                return originalState()
            }
            do {
                try checkAnchors()
                guard try current(applications) == candidate, try current(stage) == previous,
                      acceptReadback() else { return rollBack() }
                return .published
            } catch {
                return rollBack()
            }
        } catch {
            return originalState()
        }
    }

    private func checkPlacement() throws {
        try checkAnchors()
        guard try current(applications) == previous, try current(stage) == candidate else {
            throw FileRefusal.invalid
        }
    }

    private func checkAnchors() throws {
        try applications.requireAnchored()
        try stage.requireAnchored()
        guard applications.identity.device == stage.identity.device else { throw FileRefusal.invalid }
    }

    private func current(_ directory: Directory) throws -> BundleWitness? {
        guard try directory.named(name) != nil else { return nil }
        return try InstallationFiles.inspect(directory.child(name)).witness
    }

    private func originalState() -> PublishDisposition {
        do {
            try checkAnchors()
            guard try current(applications) == previous, try current(stage) == candidate else {
                return .recoveryRequired
            }
            return previous == nil ? .targetAbsentVerified : .previousInstallVerified
        } catch {
            return .recoveryRequired
        }
    }

    private func rollBack() -> PublishDisposition {
        do {
            try checkAnchors()
            guard try current(applications) == candidate, try current(stage) == previous else {
                return .recoveryRequired
            }
            let flags = previous == nil ? UInt32(RENAME_EXCL) : UInt32(RENAME_SWAP)
            guard renameatx_np(applications.fd, name, stage.fd, name, flags) == 0 else {
                return .recoveryRequired
            }
            return originalState()
        } catch {
            return .recoveryRequired
        }
    }
}

struct ReceiptStore {
    let directory: Directory

    func write(_ receipt: InstallationReceipt, replacing previous: Data?) throws {
        let filename = receipt.id + ".json"
        let scratch = ".receipt-" + UUID().uuidString.lowercased()
        let pending = try directory.createFile(scratch)
        let pendingIdentity = FileIdentity(try pending.metadata())
        var keepScratch = false
        defer {
            if !keepScratch { try? remove(scratch, identity: pendingIdentity) }
        }
        try requireSafeACL(pending, ancestor: false)
        try writeAll(pending, receipt.encode())
        guard fsync(pending.fd) == 0 else { throw FileRefusal.system(errno) }
        try directory.requireAnchored()
        try directory.match(scratch, pending, privateMode: true)

        if let previous {
            let current = try directory.openRegular(filename, privateMode: true)
            guard try readBounded(current, maximum: 16_384) == previous else { throw FileRefusal.invalid }
            try directory.match(filename, current, privateMode: true)
            guard renameatx_np(directory.fd, scratch, directory.fd, filename, UInt32(RENAME_SWAP)) == 0 else {
                throw FileRefusal.system(errno)
            }
            keepScratch = true
            try directory.match(filename, pending, privateMode: true)
            try remove(scratch, identity: FileIdentity(try current.metadata()))
        } else {
            guard renameatx_np(directory.fd, scratch, directory.fd, filename, UInt32(RENAME_EXCL)) == 0 else {
                throw FileRefusal.system(errno)
            }
            try directory.match(filename, pending, privateMode: true)
        }
        let readBack = try InstallationReceipt.read(from: directory, id: receipt.id)
        guard try readBack.encode() == receipt.encode() else { throw FileRefusal.invalid }
    }

    func bytes(_ id: String) throws -> Data {
        let filename = id + ".json"
        let handle = try directory.openRegular(filename, privateMode: true)
        let result = try readBounded(handle, maximum: 16_384)
        try directory.match(filename, handle, privateMode: true)
        return result
    }

    func discard(_ receipt: InstallationReceipt) throws {
        let filename = receipt.id + ".json"
        let handle = try directory.openRegular(filename, privateMode: true)
        guard try readBounded(handle, maximum: 16_384) == receipt.encode() else {
            throw FileRefusal.invalid
        }
        try remove(filename, identity: FileIdentity(try handle.metadata()))
    }

    private func remove(_ filename: String, identity: FileIdentity) throws {
        try directory.requireAnchored()
        guard let metadata = try directory.named(filename) else { return }
        guard isOwnedFile(metadata, privateMode: true), FileIdentity(metadata) == identity,
              unlinkat(directory.fd, filename, 0) == 0 else { throw FileRefusal.invalid }
    }
}
