// QA459I independent #459 correction QA case definitions. Not product code.
// Frozen before any observation. Each case states its purpose, the exact helper response bytes,
// the BASELINE PREDICTION for held head 2164cd11 (derived from source reading of
// apps/windows-launcher/Launcher.cs and the .NET Framework JavaScriptSerializer, not observed), and
// the CORRECTED EXPECTATION under D166's accepted F3 contract. A baseline observation that differs
// from the corrected expectation characterizes the held defect; it is not a candidate result.
import { createHash } from 'node:crypto';

export const EXPECTED = {
  head: '2164cd11624c88d66ae64d1ac86ae26505a6c1ea',
  tree: '0b1a84d1c881518b4744e2565a2874ec481921fc',
  target: '47ca4640793a81efa5bec661dba25627de314774',
  parent: '11214dadbde049af01dd0280b9b701ad10a0f50a',
};

/** Distinctive natural exit of the fixture gateway main script (unrecognized by StartupOutcome). */
export const GATEWAY_EXIT = 54;
/** Configuration.StartupTimeoutSeconds for every case: room for held retries after the 2 s reserve. */
export const STARTUP_SECONDS = 8;
/** Fixed fixture identity: 64 lowercase hex digits, like the real identity helper. */
export const IDENTITY_HEX = createHash('sha256').update('qa459i-fixture-identity').digest('hex');

const utf8 = (text) => Buffer.from(text, 'utf8');
/** The producer's own escaping: JSON.stringify of the decoded path. */
const producerPath = (path) => JSON.stringify(path);
/** Legal JSON with an additional \u escape for the non-ASCII store-name character. */
const escapedPath = (path) => JSON.stringify(path).replace(/\u03b1/g, '\\u03b1');

const HELD_TEXT = 'another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish';
const HELD_GUIDANCE = 'No second gateway was started. Do not stop an unrelated process or delete an unverified lock.';
const INVALID_TEXT = 'The read-only launcher check returned an invalid or oversized response. No gateway was started.';
const UNVERIFIED_TEXT = 'Store ownership could not be verified (malformed or incomplete owner record)';

const free = { source: 'bytes', bytes: () => utf8('{"state":"free"}\n') };
const heldValid = (id) => ({
  source: 'bytes',
  bytes: (ctx) =>
    utf8(`{"state":"held","detail":"another GraphGoblin process holds this store; QA459I_DETAIL_CANARY_${id}","path":${producerPath(ctx.lockPath)}}\n`),
});

/** Gateway-start outcome: the fixture main script ran and the launcher observed its exit 54. */
const STARTS = { authorizes: true, code: 'unknown-exit', childExit: GATEWAY_EXIT, ownershipCalls: [1, 1] };
const INVALID_INITIAL = { authorizes: false, code: 'helper-invalid', ownershipCalls: [1, 1], messageIncludes: [INVALID_TEXT] };
const HELD_REFUSAL = (calls) => ({
  authorizes: false,
  code: 'store-held',
  lock: 'lockPath',
  ownershipCalls: calls,
  messageIncludes: [HELD_TEXT, HELD_GUIDANCE],
});

export const CASES = [
  {
    id: 'Q01',
    name: 'valid-free-producer-shape',
    category: 'control: valid free',
    purpose: "Exact producer-shaped free response authorizes the ordinary gateway-start path.",
    store: { ownerRecord: false },
    ownership: [free],
    baseline: STARTS,
    corrected: STARTS,
  },
  {
    id: 'Q02',
    name: 'valid-free-legal-json-whitespace-and-escapes',
    category: 'control: legal JSON whitespace/escaping',
    purpose: 'Only RFC 8259 whitespace (SP/HT/LF/CR) outside and inside the object, plus \\u escapes in name and value, decode to a valid free response.',
    store: { ownerRecord: false },
    ownership: [{ source: 'bytes', bytes: () => utf8('\r\n \t{ \r\n\t"st\\u0061te"\t:\r\n "fr\\u0065e" \t}\r\n ') }],
    baseline: STARTS,
    corrected: STARTS,
  },
  {
    id: 'Q03',
    name: 'identity-padding-with-valid-free',
    category: 'control: identity helper padding preserved',
    purpose: 'The identity helper response keeps its existing trimmed padding behavior (space and CRLF around 64 hex digits); ownership is producer-shaped free.',
    store: { ownerRecord: false },
    identity: () => utf8(` ${IDENTITY_HEX} \r\n`),
    ownership: [free],
    baseline: STARTS,
    corrected: STARTS,
  },
  {
    id: 'Q04',
    name: 'real-producer-free',
    category: 'control: actual unmodified ownership producer (free)',
    purpose: 'The actual built apps/api/dist/instance-identity.js --store-state output for a fresh disposable store, relayed byte for byte.',
    store: { ownerRecord: false },
    ownership: [{ source: 'real-producer' }],
    baseline: STARTS,
    corrected: STARTS,
  },
  {
    id: 'Q05',
    name: 'valid-held-reordered-unicode-escaped-path',
    category: 'control: valid held, field order and path escaping',
    purpose: 'Held response with fields in a different order, escaped backslashes and a \\u03b1 escape in the lock path; repeated on every retry.',
    store: { ownerRecord: true },
    ownership: [
      {
        source: 'bytes',
        bytes: (ctx) =>
          utf8(`{"path":${escapedPath(ctx.lockPath)},"detail":"another GraphGoblin process holds this store; QA459I_DETAIL_CANARY_Q05","state":"held"}\n`),
      },
    ],
    baseline: HELD_REFUSAL([2, 60]),
    corrected: HELD_REFUSAL([2, 60]),
  },
  {
    id: 'Q06',
    name: 'real-producer-held-driver-record',
    category: 'control: actual producer (held) and byte-preserved driver-owned owner record',
    purpose: 'The actual producer reads a driver-owned malformed owner record and reports held; the record stays byte-identical.',
    store: { ownerRecord: true },
    ownership: [{ source: 'real-producer' }],
    baseline: { authorizes: false, code: 'store-unverified', lock: 'lockPath', ownershipCalls: [2, 60], messageIncludes: [UNVERIFIED_TEXT, HELD_GUIDANCE] },
    corrected: { authorizes: false, code: 'store-unverified', lock: 'lockPath', ownershipCalls: [2, 60], messageIncludes: [UNVERIFIED_TEXT, HELD_GUIDANCE] },
  },
  {
    id: 'Q07',
    name: 'held-then-inconclusive-retry-retains-guidance',
    category: 'control: inconclusive retry after held keeps held guidance',
    purpose: 'First sample is valid held; the retry returns trailing non-whitespace material that both revisions refuse. The prior held reason and lock stay in the refusal.',
    store: { ownerRecord: true },
    ownership: [heldValid('Q07'), { source: 'bytes', bytes: () => utf8('{"state":"free"} QA459I_TRAILING_CANARY_Q07\n') }],
    baseline: HELD_REFUSAL([2, 2]),
    corrected: HELD_REFUSAL([2, 2]),
  },
  {
    id: 'Q08',
    name: 'malformed-javascript-syntax-multiline-free',
    category: 'F3 malformed syntax (JavaScript-only)',
    purpose: 'Unquoted member name and single-quoted string across lines, as in the final audit.',
    store: { ownerRecord: false },
    ownership: [{ source: 'bytes', bytes: () => utf8("{\n  state: 'free'\n}\n") }],
    baseline: STARTS,
    corrected: INVALID_INITIAL,
  },
  {
    id: 'Q09',
    name: 'duplicate-decoded-name-held-then-free',
    category: 'F3 duplicate decoded name',
    purpose: 'Conflicting state fields whose names are equal only after \\u decoding; the later one says free.',
    store: { ownerRecord: false },
    ownership: [{ source: 'bytes', bytes: () => utf8('{"state":"held","st\\u0061te":"free"}\n') }],
    baseline: STARTS,
    corrected: INVALID_INITIAL,
  },
  {
    id: 'Q10',
    name: 'held-then-duplicate-free-retry',
    category: 'F3 duplicate name on the held retry path',
    purpose: 'First sample is valid held; the retry repeats the state name with a final free value. The corrected contract keeps the held refusal and its guidance.',
    store: { ownerRecord: true },
    ownership: [heldValid('Q10'), { source: 'bytes', bytes: () => utf8('{"state":"held","state":"free"}\n') }],
    baseline: { ...STARTS, ownershipCalls: [2, 2] },
    corrected: HELD_REFUSAL([2, 2]),
  },
  {
    id: 'Q11',
    name: 'outer-leading-no-break-space',
    category: 'F3 outer non-JSON whitespace',
    purpose: 'A leading U+00A0 before an otherwise exact free object: not JSON whitespace, removed by .NET Trim.',
    store: { ownerRecord: false },
    ownership: [{ source: 'bytes', bytes: () => utf8('\u00a0{"state":"free"}\n') }],
    baseline: STARTS,
    corrected: INVALID_INITIAL,
  },
  {
    id: 'Q12',
    name: 'outer-trailing-form-feed',
    category: 'F3 outer non-JSON whitespace / trailing material',
    purpose: 'A trailing U+000C after an otherwise exact free object: not JSON whitespace, removed by .NET Trim.',
    store: { ownerRecord: false },
    ownership: [{ source: 'bytes', bytes: () => utf8('{"state":"free"}\f\n') }],
    baseline: STARTS,
    corrected: INVALID_INITIAL,
  },
  {
    id: 'Q13',
    name: 'internal-line-separator-whitespace',
    category: 'F3 malformed syntax (non-JSON whitespace between tokens)',
    purpose: 'U+2028 between the colon and the value: not JSON whitespace, skipped as white space by the permissive tokenizer.',
    store: { ownerRecord: false },
    ownership: [{ source: 'bytes', bytes: () => utf8('{"state":\u2028"free"}\n') }],
    baseline: STARTS,
    corrected: INVALID_INITIAL,
  },
  {
    id: 'Q14',
    name: 'unknown-field-with-free',
    category: 'F3 unknown field',
    purpose: 'An extra member beside a free state; the held field-count check already refuses it.',
    store: { ownerRecord: false },
    ownership: [{ source: 'bytes', bytes: () => utf8('{"state":"free","detail":"QA459I_BODY_CANARY_Q14"}\n') }],
    baseline: INVALID_INITIAL,
    corrected: INVALID_INITIAL,
  },
  {
    id: 'Q15',
    name: 'invalid-string-escape-in-held',
    category: 'F3 invalid string escape',
    purpose: "A held response whose detail uses the JavaScript-only \\' escape; initial invalid output must be helper-invalid.",
    store: { ownerRecord: true },
    ownership: [
      {
        source: 'bytes',
        bytes: (ctx) =>
          utf8(`{"state":"held","path":${producerPath(ctx.lockPath)},"detail":"another GraphGoblin process holds this store \\'QA459I_ESCAPE_CANARY_Q15\\'"}\n`),
      },
    ],
    baseline: HELD_REFUSAL([2, 60]),
    corrected: INVALID_INITIAL,
  },
  {
    id: 'Q16',
    name: 'trailing-second-record',
    category: 'F3 trailing material',
    purpose: 'A second complete free record after the first; trailing non-whitespace material.',
    store: { ownerRecord: false },
    ownership: [{ source: 'bytes', bytes: () => utf8('{"state":"free"}\n{"state":"free"}\n') }],
    baseline: INVALID_INITIAL,
    corrected: INVALID_INITIAL,
  },
];

/** Driver-owned owner record: malformed on purpose (no numeric pid), never a real owner. */
export const OWNER_RECORD = utf8('{"qa459i":"driver-owned fixture owner record; never a real owner","pid":"not-a-pid"}\n');
/** Unrelated store sentinel resource, including bytes that are not valid UTF-8. */
export const STORE_SENTINEL = (id) =>
  Buffer.concat([utf8(`QA459I unrelated store sentinel ${id}\n`), Buffer.from([0x00, 0xff, 0xfe, 0x80, 0xc3, 0x0a])]);
