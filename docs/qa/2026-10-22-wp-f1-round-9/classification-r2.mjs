import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.argv[2],
  base = process.argv[3];
const cases = [
  {
    name: 'R1 explicit auth + network',
    out: '',
    err: 'API Error: 401 Authentication failed; check network settings.',
    exit: 1,
    expected: 'auth',
    fact: false,
  },
  {
    name: 'R1 explicit quota + network',
    out: '',
    err: 'HTTP 429 Too Many Requests; network request failed.',
    exit: 1,
    expected: 'quota',
  },
  {
    name: 'R1 stdout quota + unrelated stderr',
    out: 'API Error: 429 Too Many Requests',
    err: 'Warning: setting is deprecated',
    exit: 1,
    expected: 'quota',
  },
  { name: 'R1 empty success', out: '', err: '', exit: 0, expected: 'unknown' },
  { name: 'R1 empty object success', out: '{}', err: '', exit: 0, expected: 'unknown' },
  {
    name: 'status inside longer sentence',
    out: '',
    err: 'Refresh attempt finished: HTTP/2 401 — Anmeldung erforderlich; check network settings before retry.',
    exit: 1,
    expected: 'auth',
    fact: false,
  },
  {
    name: 'localized HTTP 403',
    out: '',
    err: 'Le serveur répond HTTP 403 : accès refusé; réseau disponible.',
    exit: 1,
    expected: 'auth',
    fact: false,
  },
  {
    name: 'localized status_code quota',
    out: '',
    err: '{"error":{"status_code":429,"message":"ネットワーク要求の上限"}}',
    exit: 1,
    expected: 'quota',
  },
  {
    name: 'API 503 with auth words',
    out: '',
    err: 'Authentication refresh returned API Error: 503 Service Unavailable',
    exit: 1,
    expected: 'transport',
  },
  {
    name: 'actual connection + auth words',
    out: '',
    err: 'Failed to connect to authentication server: ECONNREFUSED',
    exit: 1,
    expected: 'transport',
  },
  {
    name: 'syntax + network + auth status',
    out: '',
    err: "error: unknown option '--network-access'; HTTP 401",
    exit: 1,
    expected: 'cli-incompatible',
  },
  {
    name: 'stdout quota, stderr auth conflict',
    out: 'HTTP 429 Too Many Requests',
    err: 'HTTP 401 Unauthorized',
    exit: 1,
    expectedByHarness: { claude: 'auth' },
    factByHarness: { claude: false },
  },
  {
    name: 'stdout auth, stderr quota conflict',
    out: 'HTTP 401 Unauthorized',
    err: 'HTTP 429 Too Many Requests',
    exit: 1,
    expectedByHarness: { claude: 'quota' },
  },
  {
    name: 'stdout transport, stderr quota conflict',
    out: 'HTTP 503 Service Unavailable',
    err: 'HTTP 429 Too Many Requests',
    exit: 1,
    expectedByHarness: { claude: 'quota' },
  },
  {
    name: 'structured sign-out with conflicting stderr',
    out: '{"loggedIn":false,"authMethod":"none"}',
    err: 'HTTP 429 Too Many Requests',
    exit: 1,
    expectedByHarness: { claude: 'auth' },
    factByHarness: { claude: false },
  },
  { name: 'malformed JSON success', out: '{"loggedIn":', err: '', exit: 0, expected: 'unknown' },
  { name: 'JSON null success', out: 'null', err: '', exit: 0, expected: 'unknown' },
  { name: 'JSON array success', out: '[]', err: '', exit: 0, expected: 'unknown' },
  {
    name: 'unrecognized success',
    out: 'auth status result unavailable',
    err: '',
    exit: 0,
    expected: 'unknown',
  },
  {
    name: 'recognized plaintext sign-out stdout success',
    out: 'Not logged in',
    err: '',
    exit: 0,
    expected: 'auth',
    fact: false,
  },
  {
    name: 'recognized plaintext sign-out stderr success',
    out: '',
    err: 'Not logged in',
    exit: 0,
    expected: 'auth',
    fact: false,
  },
  {
    name: 'native-format sign-out success',
    outByHarness: { claude: '{"loggedIn":false,"authMethod":"none"}', codex: 'Not logged in' },
    err: '',
    exit: 0,
    expected: 'auth',
    fact: false,
  },
  {
    name: 'native-format sign-in success',
    outByHarness: {
      claude: '{"loggedIn":true,"authMethod":"claude.ai"}',
      codex: 'Logged in using ChatGPT',
    },
    err: '',
    exit: 0,
    expected: 'ready',
    fact: true,
  },
  { name: 'partial auth output failed', out: 'Unauth', err: '', exit: 1, expected: 'unknown' },
  { name: 'empty failed exit', out: '', err: '', exit: 1, expected: 'unknown' },
  {
    name: 'localized unknown failed',
    out: '',
    err: '要求を処理できませんでした',
    exit: 1,
    expected: 'unknown',
  },
  {
    name: 'diagnostic sentinel',
    out: '',
    err: 'HTTP 429 Too Many Requests PRIVATE_AUDIT_SENTINEL',
    exit: 1,
    expected: 'quota',
  },
];
const evidence = [];
try {
  for (const test of cases) {
    for (const h of ['claude', 'codex']) {
      await writeFile(join(root, h, 'scenario.txt'), 'ready');
      const out = test.outByHarness?.[h] ?? test.out ?? '';
      await writeFile(
        join(root, h, 'auth.txt'),
        [
          test.exit,
          0,
          Buffer.from(out).toString('base64'),
          Buffer.from(test.err ?? '').toString('base64'),
          0,
        ].join('\n'),
      );
    }
    const started = Date.now();
    const response = await fetch(base + '/harness/preflight');
    const result = await response.json();
    const actual = result.items.map((item) => {
      const expected = test.expectedByHarness?.[item.harness] ?? test.expected;
      const fact = test.factByHarness?.[item.harness] ?? test.fact;
      const factPresent = Object.hasOwn(item, 'authenticated');
      return {
        harness: item.harness,
        state: item.state,
        authenticated: item.authenticated,
        authenticatedPresent: factPresent,
        problems: item.problems,
        expected,
        expectedAuthenticated: fact,
        pass:
          expected === undefined
            ? null
            : item.state === expected &&
              (fact === undefined ? !factPresent : item.authenticated === fact),
      };
    });
    const record = {
      ...test,
      http: response.status,
      ms: Date.now() - started,
      actual,
      sentinelExposed: JSON.stringify(result).includes('PRIVATE_AUDIT_SENTINEL'),
    };
    evidence.push(record);
    await writeFile(join(root, 'classification-r2.json'), JSON.stringify(evidence, null, 2));
    console.log(
      JSON.stringify({
        name: test.name,
        actual: actual.map((x) => ({
          h: x.harness,
          state: x.state,
          authenticated: x.authenticated,
          pass: x.pass,
        })),
      }),
    );
  }
} finally {
  for (const h of ['claude', 'codex']) await unlink(join(root, h, 'auth.txt')).catch(() => {});
}
