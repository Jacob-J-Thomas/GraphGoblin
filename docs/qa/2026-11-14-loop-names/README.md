# Loop-name admission implementation evidence

The repository baseline was `b3b5e1874a8252cc01c065d18fef42cbfbe075b4`. Test-only
changes at that baseline reproduced four duplicate admissions. Ordinary create returned
201 for an equivalent Unicode name, draft save returned 200 when taking another loop's
name, unchanged exported JSON imported as a duplicate loop, and a template copy created
an equivalent name. Each now returns `409 LOOP_NAME_CONFLICT`.

| Boundary                                 | Verified behavior                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public API with the normal Fastify stack | Concurrent create/create, create/rename and template/import calls admit one equivalent name. Explicit import or template naming creates a distinct copy. The collision leaves prior loop IDs and drafts unchanged. An obsolete draft token still yields `DRAFT_CONFLICT` and the current token.                                                                                                                                                          |
| Names through native SQLite              | A second write connection is refused with SQLite busy while an independent write transaction owns the file. Once the writer commits, a request from the second connection sees the stored name and returns the typed name conflict. A different owner may keep an equivalent name. Current-format readonly checks name existing duplicate IDs or a stored NUL. The previous-save route's repair operation retains IDs and reopens with both definitions. |
| System Chat                              | A colliding generated gateway name chooses an available name with the binding, and reinitialization reuses that binding. Case/whitespace-equivalent device labels keep distinct bound loops. A device label with characters the loop column cannot round-trip yields a well-formed generated loop name.                                                                                                                                                  |
| API client                               | The original export stays in the body and the explicit copy name goes in the query. A conflict suggestion remains advisory when another writer claims that name.                                                                                                                                                                                                                                                                                         |
| Text boundaries                          | The native text driver truncates returned text at NUL and coerces lone UTF-16 surrogates. The four authored write paths refuse both and preserve valid replacement characters and supplementary pairs. Repeated copy suffixes stay within the loop name limit without bisecting a surrogate pair.                                                                                                                                                        |

The focused API matrix passed 133 tests in eight files. The native SQLite matrix passed
four tests, and the typed client suite passed nine. The focused Turbo typecheck and lint
gates passed. The existing built-API upgrade suite passed both cases, retaining fresh
and valid current-format startup and older-format refusal. API tests use ordinary route injection
and an isolated real SQLite database. The file-store tests use separate native SQLite clients.
They do not depend on a running personal gateway or any provider turns.

The first cross-connection fixture set a connection-specific PRAGMA and later reported
an in-progress statement at commit. After removing the PRAGMA, reusing the second read
connection did not see the next commit by the other writer. The retained test uses the
ordinary transaction path and a fresh observer to compare the committed state. Both
earlier fixture runs are retained with the batch artifacts. Other touched API tests now use
unique fixture names or explicitly named copies when the test is about stored settings,
workflow graph retention, or a different lifecycle boundary.

| Retained log, LF normalized                                                | SHA-256                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Baseline negative API cases](loop-names-209-baseline.log.txt)             | `274807feaba2069a3cd16a6bbfa8abd2bb9b07d0102e8d7dd41a6b57d2afa52f` |
| [Public API regression matrix](loop-names-209-api-matrix-final.log.txt)    | `c693add0ec652b1d24cd4549fd2126c6db094d8cb149c88637ca72e6f53c574b` |
| [SQLite connection and store matrix](loop-names-209-sqlite-matrix.log.txt) | `70eaad038450f7dff7ffae21d1a188aaaf58670c7d8eb54166ce1dc6c5b907f0` |
| [Typed client tests](loop-names-209-client.log.txt)                        | `914bddcdd8f65ec118cb06dc7f0091edd5f789d3b47d39ae4491d2b069c46d06` |

The combined backend and UI change needs the full repository gates, supported browser
flows, independent touched-systems QA and the required review decisions. This record
documents implementation checks for the backend slice.
