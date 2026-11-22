# #486 JSONata literal-error contract facts

**Planning validation only.** One fixed 40-case probe ran on clean source `02351e2fb932b3be44e7cc3fb3943a61d568226c`, tree `d289bb12b943557584c5659bc33447d1baebc2f6`. All 40 prewritten AST/raw/domain predictions matched. This does not mean 40 accepted labels or product acceptance. No classifier/helper, product change, formal review, plan selection/approval or public write was made. Revision 02's original proposal is copied under `design-inputs/`.

**The material provenance fact:** root `$error` AST shape plus raw D3137 is insufficient when the low-level public domain API permits an own enumerable `bindings.error` replacement. Both a JavaScript callback and a JSONata function-shaped object produced D3137 and the **same domain `{name,code,message,details}` projection** as the actual builtin for the identical source. The current domain wrapper drops raw D3137. Any future label exception needs actual builtin/evaluator ownership established before public wrapping; a name, code or error class alone does not establish it. Root/Fable must select the guard and implementation.

## Binding and execution

- Project Node **v22.23.4**, pnpm **12.8.1**, Windows x64. Frozen offline installation exited 0 in 14.8 s, reused 801 packages and downloaded 0. Only ignored install outputs were added. Lock SHA-256 stayed `3fda48ff6e5a65af5a280ede5364ea23ae21fb32c068e3e1cf8835c12a0916df`.
- Actual patched **JSONata 2.2.2** loaded from the domain dependency junction. Loaded `jsonata.js` SHA-256: `10965a9e3d86ccaf87f55294959637898e918c7ef5181af72d13279c8fc8e6de`; patch SHA-256: `c946341f2ec643121e3296159f896f45cd24fcc3bb6ad26abe6760d3306670e0`. Exact resolved paths/package hashes and the builtin implementation-source hash are in `execution-input.json`; dependency bytes are retained separately.
- The public `@graphgoblin/domain` entry was resolved through its actual `development` export. `evaluateExpression` came from that entry. AST inspection separately used `expression.ts`'s `expressionAst`, which is **not re-exported by the package entry**. No AST was modified; all 40 before/after observations remained equal.
- `cases.json` and `predictions.json` were written before execution and hash-bound in `execution-input.json`. One probe invocation exited 0, with 40 raw and 40 domain top-level evaluations plus a builtin-function-value lookup. Each domain evaluation used a 1,000 ms / depth-100 bound. There was no fuzzer, provider, network service, app build, full test suite or coverage run. `observations.jsonl` and `results.json` directly retain every runtime observation, stack, AST and controlled callback/getter count. Synthetic canaries remain private in these raw QA files and scripts.

## AST and runtime discriminators

| Cases | Actual facts |
| --- | --- |
| C01–C05: 1/128-character literals, source whitespace, single quotes, escaped ASCII | Root `type: function`, procedure `type: variable` / value `error`, one argument `type: string`. Escaped ASCII is decoded into the AST string value. Raw builtin D3137; domain EXPRESSION_ERROR. Source whitespace does not create a wrapper node. |
| C06–C07: grouping and a multi-expression block | Both roots are `block`, while the executed inner builtin still throws D3137. Even simple parentheses change the root shape under this pinned parser. Unwrapping groups would be a design choice beyond the proposal's strict root wording. |
| C08–C10: taken/untaken conditional and nested call | Conditional roots are `condition`; taken branch gives D3137, untaken branch returns. Nested call has root procedure `string` with the `$error` call inside its argument. D3137 alone does not distinguish these cases from a direct call. |
| C11: `$eval` | Root procedure `eval`; raw JSONata wraps the nested error as D3121. The actual domain checked-eval path emits EXPRESSION_ERROR with its own bounded eval message. This is not a root direct builtin-error case. |
| C12–C13: input-derived and concatenated messages | Root procedure `error`, but argument types are respectively `path` and `binary`, not static string literals. Both nevertheless throw D3137. |
| C14–C15: `$assert` false/true | Procedure `assert`; false yields D3141, true returns undefined. It is not the literal `$error` exception. |
| C16–C25: empty, 129 characters, Unicode, newline/CR/tab/NUL/DEL, excluded punctuation, space-only | These remain string-literal AST arguments and builtin D3137. JSONata enforces none of the proposal's label alphabet/length restrictions. Empty text uses the builtin default message; one space is retained as one space. The proposal's stated alphabet permits a blank-looking space-only label unless root/Fable adds a further rule. |
| C26–C28: arity and lexical shadowing | Zero-argument `$error()` still gives D3137; two arguments give T0410. A lexical replacement inside a block returns the replacement's value, with root `block`. One literal argument and actual builtin provenance are separate requirements. |

The decoded AST value, its length and actual code points are retained in the raw AST. In particular, the 128/129 boundary and final control characters cannot be inferred from the runtime code or a trimmed/interpolated message. Do not use the exception text as the label source.

## Twelve low-level binding/cache seams

| Cases | Actual facts |
| --- | --- |
| S01 | Own enumerable `bindings.error` callback returns normally despite unchanged root direct-call AST. The callback ran once. |
| S02–S03 | Own enumerable callback and `_jsonata_function` object each ran once, threw D3137 and collided exactly with the builtin's domain name/code/message/details projection. The function-shaped flag is also not builtin identity. |
| S04–S05 | Non-enumerable and inherited `error` properties were omitted by the domain's object spread; callback count stayed zero and the actual builtin ran. A check based only on property lookup would misdescribe the effective binding. |
| S06, S11 | An enumerable getter on `error`, and separately on an unrelated binding name, threw during spreading **before JSONata evaluation**. Each getter ran once; the domain turned both into EXPRESSION_ERROR with expression details. This is a preparation fault, not proof that `$error` executed. |
| S07 | Supplying the actual captured builtin function object as an own enumerable binding still runs that builtin and produces D3137. Whether to conservatively exclude all own `error` bindings or support verified identity is for root/Fable to decide. |
| S08–S09 | A binding key literally named `$error`, and separately an input object's `error` function property, did not replace `$error`; replacement callbacks did not run. These controls distinguish actual binding semantics. |
| S10 | A supplied callback threw an actual existing ExpressionError. The domain passed through the **same error object and supplied details**, without wrapping it. `instanceof ExpressionError` is not authored-origin proof at this API seam. |
| S12 | Re-evaluating the same cached source with ordinary bindings restored the builtin; the preceding replacement did not persist into this later evaluation. This finite observation does not establish arbitrary cache/concurrency behavior. |

This reachability is through JavaScript's **public low-level `ExpressionOptions.bindings` API**, whose values are `unknown` and can include functions/accessors. It is not a demonstrated attack through a serialized loop or JSON input. Source inspection of relevant engine calls found ordinary default bindings or freshly constructed `thread`/`index` bindings (selectors, wait filter); no current engine-supplied `error` override was observed. No engine/API/browser flow was executed, and that source inspection is not an exhaustive reachability audit.

## Constraints for the plan recheck

The facts support retaining separate requirements for (1) strict root direct-call AST and exact one-string arity; (2) the entire decoded literal's 1–128 length and `[A-Za-z0-9 _-]` character policy, including its last character; and (3) the corresponding **actual builtin-owned** runtime D3137 before domain wrapping. Grouped/nested/conditional/eval/assert/dynamic forms must not qualify merely because they eventually throw D3137. Neither a public-domain error's code/class nor a function-shaped value establishes ownership. Getter/spread preparation faults and externally supplied existing ExpressionError objects need their own provenance boundary. Do not select a guard or publish a label from these probes alone.

The harness also ran an unpredicted standalone JavaScript regex control with no flags: `^[A-Za-z0-9 _-]{1,128}$` matched a one-character ASCII sample and **rejected** that sample followed by a newline on this Node runtime. The original harness called that control “deliberately incomplete”; that label is not supported by the observed newline result and is retained unchanged. It is not evidence of an end-anchor bypass, nor a tested complete classifier. The full-string requirement remains; no validator algorithm or flags are selected here.

## Integrity and limits

The source, lockfile and index are unchanged; final Git status/diffs are clean. Index SHA-256 remains `2e4ac328a32b369622f7525cd76afc076ba7450be3b55adf977f2a331cb94df0`. The [manifest](manifest.json) seals the original scripts, prewritten cases/predictions, raw results/JSONL/logs, design/source/dependency snapshots and fresh binding. There were no failed fixture executions, post-run fixture corrections or behavioral reruns; all 40 predictions matched. The additional regex-control wording discrepancy is documented rather than repaired retrospectively.

This report supplies read-only input for S5/Fable's targeted plan recheck. It does not implement the proposed failure projection, establish B20's eventual message behavior, accept a plan, consume a formal review slot, claim safe publication of raw canaries, or replace independent implementation QA, opposite-family review, CI, coverage or final audit gates.
