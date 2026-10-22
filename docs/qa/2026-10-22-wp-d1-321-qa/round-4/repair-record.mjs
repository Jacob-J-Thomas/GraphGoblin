// Evidence-only repair. No applications, tests, stores, or Git mutations.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const out = new URL('.', import.meta.url);
const root = new URL('../', out);
const repo = new URL('../../../../', out);
const prefix = 'docs/qa/2026-10-22-wp-d1-321-qa/';
const head = '93c22e9cddef7af5b6de7587ca14305466ba5b7c';
const originalRevision = '0e6ab27e21caa9ec99b4088d92c8e1ebb88ba767';
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
assert.equal(git('rev-parse', 'HEAD').trim(), head);
const readHead = (name) => git('show', `HEAD:${prefix}${name}`);
const committed = new Set(
  git('ls-tree', '-r', '--name-only', 'HEAD', prefix)
    .trim()
    .split(/\r?\n/)
    .map((p) => p.slice(prefix.length)),
);
const gateNames = [
  'build',
  'contracts',
  'engine',
  'recovery-process',
  'restart',
  'edge',
  'mcp',
  'typecheck',
  'infrastructure',
  'lint',
  'layers',
  'deps',
  'docs',
  'tokens',
  'native-isolated',
  'client-types',
  'native-other-isolated',
  'web',
  'format',
];
const names = [
  ...gateNames.map((n) => n + '.log'),
  'corrected-results.json',
  'corrected-edge-observations.json',
  'independent-results.json',
  'edge.log.txt',
  'typecheck.log.txt',
  'mcp.log.txt',
  'format.log.txt',
  'prepare-fixtures.mjs',
  'run-gates.ps1',
];
assert.equal(names.length, 28);
const replacements = {
  'build.log': ['round-3/build.log.txt', 'Later round-3 build; different revision and duration.'],
  'recovery-process.log': [
    'round-2/recovery-process.log.txt',
    'Later round-2 built-process recovery acceptance. Round 3 did not repeat this standalone command.',
  ],
  'restart.log': [
    'round-3/pair-2.log.txt',
    'Later round-3 script/child restart pair, six passing cases.',
  ],
  'edge.log': [
    'round-2/edge.log.txt',
    'Later round-2 standalone Edge acceptance. No round-3 browser replacement exists.',
  ],
  'mcp.log': [
    'round-2/mcp.log.txt',
    'Later round-2 focused MCP tests; not the original invocation.',
  ],
  'typecheck.log': [
    'round-2/typecheck.log.txt',
    'Later round-2 full typecheck; not the original invocation.',
  ],
  'client-types.log': [
    'round-2/client-types.log.txt',
    'Later round-2 generated-client compile probe.',
  ],
  'format.log': [
    'round-2/format.log.txt',
    'Later round-2 full format check; round-3 format checked its evidence only.',
  ],
  'corrected-results.json': [
    'round-2/corrected-results.json',
    'Fresh round-2 API/native/Edge/MCP observations; not recovered round-1 IDs or timestamps.',
  ],
  'corrected-edge-observations.json': [
    'round-2/corrected-edge-observations.json',
    'Fresh round-2 dialog and timeline capture; not the original capture.',
  ],
  'independent-results.json': [
    'round-2/independent-results.json',
    'Fresh round-2 independent matrix, including narrow/keyboard/concurrent-choice checks.',
  ],
  'prepare-fixtures.mjs': [
    'round-2/prepare-fixtures.mjs',
    'Round-2 reconstructed fixture generator; recipe replacement, not original source recovery.',
  ],
  'run-gates.ps1': [
    'round-2/run-gates.ps1',
    'Round-2 reconstructed runner; recipe replacement, not original source recovery.',
  ],
};
for (const name of ['edge', 'typecheck', 'mcp', 'format'])
  replacements[name + '.log.txt'] = replacements[name + '.log'];
const exists = async (url) => {
  try {
    await fs.access(url);
    return true;
  } catch {
    return false;
  }
};
const tempNames = await fs.readdir(tmpdir(), { withFileTypes: true });
const ownedTemp = tempNames.filter((e) => e.name.startsWith('gg-qa-321-'));
assert.equal(
  ownedTemp.filter((e) => e.isDirectory()).length,
  0,
  'Surviving QA TEMP directories need inspection before declaring originals lost.',
);
const dispositions = [];
for (const name of names) {
  assert(!committed.has(name), `Audit name unexpectedly committed: ${name}`);
  // The historical raw-log inventory placed these at the TEMP root. Also inspect
  // any surviving QA-prefixed temporary directories; never traverse owner data.
  const rawName = 'gg-qa-321-' + name.replace(/\.log\.txt$/, '.log');
  const candidates = [new URL(name, root), new URL(name + '.txt', root)];
  let originalPresent = (await Promise.all(candidates.map(exists))).some(Boolean);
  originalPresent ||= ownedTemp.some((e) => !e.isDirectory() && [name, rawName].includes(e.name));
  assert(
    !originalPresent,
    `Original candidate found; inspect and preserve before marking lost: ${name}`,
  );
  const replacement = replacements[name];
  if (replacement)
    assert(committed.has(replacement[0]), `Replacement is not in HEAD: ${replacement[0]}`);
  dispositions.push({
    originalPath: name,
    originalRevision,
    disposition: 'original not kept',
    originalRecovered: false,
    replacement: replacement
      ? {
          path: replacement[0],
          round: replacement[0].startsWith('round-3') ? 'round 3' : 'round 2',
          kind:
            name.endsWith('.mjs') || name.endsWith('.ps1')
              ? 'reconstructed recipe'
              : 'later observation',
          scope: replacement[1],
          inHead: true,
        }
      : null,
    limitation: replacement
      ? 'Later evidence does not authenticate the missing original transcript or its historical numbers.'
      : 'No equivalent retained round-3 verification for this full gate/isolation. Historical result remains in gate-checks.json and gates.jsonl; no replacement run was performed.',
  });
}
const byName = new Map(dispositions.map((d) => [d.originalPath, d]));
const historicalInputs = {
  'recovery-process.integration.mjs': 'round-2/recovery-process.integration.mjs',
  'api.config.mts': 'round-2/api.config.mts',
  'playwright.script-recovery.config.ts': 'round-2/playwright.script-recovery.config.ts',
  'infrastructure.config.mts': 'round-2/infrastructure.config.mts',
  'client-config.json': 'round-2/client-config.json',
};
const gates = JSON.parse(readHead('gate-checks.json'));
for (const row of gates) {
  if (byName.has(row.evidence)) row.evidenceRetention = byName.get(row.evidence);
  const inputs = Object.entries(historicalInputs).filter(([name]) =>
    row.steps.includes(prefix + name),
  );
  if (inputs.length)
    row.historicalQaInputs = inputs.map(([name, replacement]) => ({
      path: name,
      disposition: 'original not kept',
      replacement,
      replacementLabel: 'round-2 reconstructed input; not the original command input',
    }));
}
const checks = JSON.parse(readHead('checks.json'));
for (const row of checks)
  if (byName.has(row.evidence)) row.evidenceRetention = byName.get(row.evidence);
await fs.writeFile(new URL('gate-checks.json', root), JSON.stringify(gates, null, 2) + '\n');
await fs.writeFile(new URL('checks.json', root), JSON.stringify(checks, null, 2) + '\n');

let report = readHead('report.md');
for (const name of [...names].sort((a, b) => b.length - a.length)) {
  const d = byName.get(name);
  const replacement = d.replacement;
  const note = replacement
    ? `original not kept; [${replacement.round} ${replacement.kind}](${replacement.path})`
    : 'original not kept; no equivalent retained round-3 gate/isolation';
  report = report.replaceAll('`' + name + '`', '`' + name + '` (' + note + ')');
}
report = report.replace(
  '# Independent QA: WP-D1 #321\n',
  '# Independent QA: WP-D1 #321\n\n> Round-4 retention correction on `' +
    head +
    '`: this is the historical round-1 report. Missing originals are labelled at each citation; later evidence has its own round/revision and never substitutes for the recorded original values. [The 28-path disposition report](round-4/README.md) and [machine-readable dispositions](round-4/citation-dispositions.json) record every loss. The original runner and QA inputs were not kept; the [retained round-2 recipe](round-2/README.md) is reconstructed. Statements about temporary files remaining describe round 1 only: those originals are no longer present at this check. No behavior check was repeated in round 4.\n',
);
report = report.replace(
  'It contains the report, structured observations, sanitized gate logs, independent runner and QA-only fixture/configuration copies.',
  'It originally contained the report, structured observations, sanitized gate logs, independent runner and QA-only fixture/configuration copies; the missing originals are now explicitly labelled, rather than claimed to be retained.',
);
await fs.writeFile(new URL('report.md', root), report);

const recipe = `# Independent QA for WP-D1 #321\n\nTarget of the historical round-1 observations: \`${originalRevision}\`. Source branch: \`codex-wp-d1-child-recovery\`, stacked on \`wp-d1-320\`; independent QA worktree \`codex-qa-wp-d1-321\`.\n\nThe historical report is [report.md](report.md). [checks.json](checks.json) retains per-check steps, expectations, original results and evidence-loss notes. [gate-checks.json](gate-checks.json) and [gates.jsonl](gates.jsonl) retain the original gate results, commands and durations. Missing raw transcripts cannot authenticate those historical summaries. The [round-4 report](round-4/README.md) and [28-path disposition manifest](round-4/citation-dispositions.json) explicitly identify every missing original. No original was recovered and no behavior was rerun in round 4.\n\n## Retained replay recipe\n\nThe round-1 \`prepare-fixtures.mjs\` (original not kept) and \`run-gates.ps1\` (original not kept) are gone. Use the explicitly reconstructed [round-2 fixture generator](round-2/prepare-fixtures.mjs), [round-2 runner](round-2/run-gates.ps1) and [round-2 instructions](round-2/README.md). These are retained replacements, not the original sources. Their recorded outputs are fresh round-2 observations at \`a5cd26c496e7ae59e13748e7c879d072064ace0f\`; they are not current-head results.\n\nThe root command history is archival. Its root-local fixture/configuration inputs were not kept; each affected gate entry now identifies its reconstructed round-2 input. Do not execute the archival commands as if those root inputs still existed. Node 22 must be first on PATH and PowerShell uses pnpm.cmd. The retained recipe documents disposable stores, ports 5920–5929, fake harnesses, process exit and cleanup. Owner ports 4747/4748 and the owner store remain excluded.\n\nThe [round-3 report](round-3/README.md) at \`a44744f11d5c37000fe8354754fb3d8a82e3a4fa\` independently verifies the restart-port split and API suites. It contains no fresh Edge, MCP, full contracts/engine/infrastructure/web coverage, or full-repository lint/layer/dependency/docs/token gate replacement. Matching round-2 evidence is linked where available; otherwise the loss is explicit and no equivalent replacement is claimed.\n\n[retained-temp-files.json](retained-temp-files.json) is a historical round-1 inventory, not a current availability promise. Those files are no longer present in the original TEMP locations checked in round 4. Round 4 started no application or provider, created no temporary store and removed no directory.\n`;
await fs.writeFile(new URL('README.md', root), recipe);
const oldInventory = JSON.parse(readHead('retained-temp-files.json'));
await fs.writeFile(
  new URL('retained-temp-files.json', root),
  JSON.stringify(
    {
      origin: 'Historical inventory of files left in TEMP after round 1',
      checkedRevision: head,
      currentAvailability:
        'originals not kept; no longer present in the original TEMP locations at round-4 inspection',
      filenames: oldInventory,
      note: 'Basenames are historical inventory entries, not links to retained evidence. No cleanup or deletion was attempted in round 4.',
    },
    null,
    2,
  ) + '\n',
);
await fs.writeFile(
  new URL('citation-dispositions.json', out),
  JSON.stringify(
    {
      head,
      originalRevision,
      scope: '28 audit paths in original QA root; evidence repair only',
      originalRecovered: 0,
      behaviorRegenerations: 0,
      losses: dispositions,
      temporarySearch: {
        method:
          'Check QA root, original TEMP-root raw basenames, and inventory of surviving gg-qa-321- prefixed TEMP entries. No such TEMP entries survived; no unrelated temporary folder or owner store was searched.',
        matchingEntries: ownedTemp.map((e) => e.name),
      },
      historicalQaInputs: Object.entries(historicalInputs).map(([path, replacement]) => ({
        path,
        disposition: 'original not kept',
        replacement,
        label: 'round-2 reconstructed input',
      })),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  '28 original paths explicitly recorded as not kept; no historical measurements changed; no behavior executed.',
);
