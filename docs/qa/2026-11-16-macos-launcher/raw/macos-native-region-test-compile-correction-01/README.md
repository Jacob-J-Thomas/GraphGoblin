# Installer test compilation correction

The isolated Mac compile with the installed Testing framework on the search path reached two source errors. Both Installer suites could see the package decoder initializer for `BundleWitness`. Their plain `LauncherEngine` import did not expose its internal memberwise initializer. Each initializer call produced one missing-argument and one extra-arguments diagnostic.

Each suite now uses `@testable import LauncherEngine`, as the Engine tests already do. The two import lines are the entire correction. The malformed witness construction, case selection, expected outcomes and shipping source are unchanged. Reverse application of the independent correction diff and the scoped whitespace check passed.

The failed compiler streams remain in `macos-native-test-build-13-ce2f50c989104d7a8869c2687b758b93`. The earlier sealed test implementation handoff is unchanged. Root owns the next isolated build. Native test execution and measured region coverage still require hosted CI.
