import Foundation

struct Admission: Encodable {
    let version: Int
    let root: String
    let device: String
    let inode: String
}

let arguments = CommandLine.arguments
precondition(arguments.count == 5)
let admission = Admission(version: 1, root: arguments[2], device: arguments[3], inode: arguments[4])
let dictionary: [String: Any] = [
    "version": admission.version, "root": admission.root,
    "device": admission.device, "inode": admission.inode
]

let bytes: Data
switch arguments[1] {
case "sorted":
    bytes = try JSONSerialization.data(withJSONObject: dictionary, options: [.sortedKeys, .withoutEscapingSlashes])
case "unsorted":
    bytes = try JSONSerialization.data(withJSONObject: dictionary, options: [.withoutEscapingSlashes])
case "typed":
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    bytes = try encoder.encode(admission)
default:
    fatalError("Unknown fixture serialization")
}

precondition(bytes.count <= 4_096 && String(data: bytes, encoding: .utf8) != nil)
FileHandle.standardOutput.write(bytes + Data([10]))

