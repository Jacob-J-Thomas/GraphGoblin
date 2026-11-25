@inline(never)
func branchWitness(_ selector: String) -> Int {
    if selector == "take-true" {
        return 81 // taken-arm
    } else {
        return -42 // untaken-arm
    }
}

print(branchWitness(CommandLine.arguments[1]))

