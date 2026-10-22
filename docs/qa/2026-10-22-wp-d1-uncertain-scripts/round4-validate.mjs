// Validate retained file references without editing the independent QA bundles.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const destination = 'docs/qa/2026-10-22-wp-d1-uncertain-scripts';
const scopes = [destination, 'docs/qa/2026-10-22-wp-d1-321-qa'];
const walk = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory() && !entry.isSymbolicLink() ? walk(name) : [name];
  });
const slash = (name) => name.replaceAll('\\', '/');
const files = scopes.flatMap(walk).map(slash);
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 20_000_000 })
  .split('\0')
  .filter(Boolean);
const allFiles = [...new Set([...tracked, ...files])];
const references = [];
const isFile = (filename) => {
  try {
    return fs.statSync(filename).isFile();
  } catch {
    return false;
  }
};
const sourceBindings = {
  [`${destination}/browser-before-stream-fix.md:script-recovery.browser.ts`]:
    'apps/web/e2e/script-recovery.browser.ts',
  [`${destination}/README.md:playwright.script-recovery.config.ts`]:
    'apps/web/playwright.script-recovery.config.ts',
  [`${destination}/verification.md:script-recovery.test.ts`]:
    'packages/engine/src/script-recovery.test.ts',
  [`${destination}/verification.md:run.ts`]: 'packages/contracts/src/run.ts',
  [`${destination}/verification.md:events.ts`]: 'packages/contracts/src/events.ts',
  [`${destination}/verification.md:errors.ts`]: 'packages/engine/src/errors.ts',
};
function resolve(source, value, kind) {
  const decoded = decodeURIComponent(
    value
      .replace(/^<|>$/g, '')
      .replace(/#.*$/, '')
      .replace(/:\d+(?:[-–]\d+)?$/, ''),
  );
  if (!decoded || /^https?:|^mailto:|^plugin:|^data:/i.test(decoded))
    return { status: 'external-or-anchor' };
  const normalized = slash(decoded);
  const candidates = [
    path.resolve(path.dirname(source), normalized),
    path.resolve(root, normalized),
  ];
  const exact = candidates.find(isFile);
  if (exact)
    return {
      status: 'resolved',
      file: slash(path.relative(root, exact)),
      resolution: 'relative-or-repository-path',
    };
  if (kind === 'markdown-link' || kind === 'json-log-or-inventory')
    return { status: 'unresolved', candidates: [] };
  if (normalized === 'pnpm.cmd')
    return {
      status: 'command-reference',
      reason: 'Installed command, not a cited worktree artifact.',
    };
  const binding = sourceBindings[`${source}:${normalized}`];
  if (binding && isFile(binding))
    return {
      status: 'resolved',
      file: binding,
      resolution: 'explicit-source-context-in-the-prose',
    };
  if (!/\.[cm]?tsx?$/.test(normalized)) return { status: 'unresolved', candidates: [] };
  const suffix = allFiles.filter((name) => name === normalized || name.endsWith('/' + normalized));
  if (suffix.length === 1 && isFile(suffix[0]))
    return { status: 'resolved', file: suffix[0], resolution: 'unique-repository-suffix' };
  const basename = allFiles.filter((name) => path.basename(name) === path.basename(normalized));
  if (basename.length === 1 && isFile(basename[0]))
    return { status: 'resolved', file: basename[0], resolution: 'unique-repository-basename' };
  return { status: 'unresolved', candidates: suffix.length ? suffix : basename };
}
function add(source, value, kind, location) {
  if (
    !references.some(
      (entry) =>
        entry.source === source &&
        entry.value === value &&
        entry.kind === kind &&
        entry.location === location,
    )
  )
    references.push({ source, value, kind, location, ...resolve(source, value, kind) });
}
const extension =
  /(?:[A-Za-z0-9_@.%+<>~-]+[\\/])*[A-Za-z0-9_@.%+<>~-]+\.(?:log(?:\.txt)?|jsonl?|md|mjs|cjs|[cm]?tsx?|png|txt|ya?ml|html|sqlite3?|db|cmd|ps1)\b/g;
for (const filename of files.filter((name) => /\.(md|jsonl?)$/.test(name))) {
  if (filename.endsWith('/round4-reference-validation.json')) continue;
  const text = fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '');
  if (filename.endsWith('.md')) {
    // Code fences contain source/API method names and PowerShell array indexing, not prose links.
    const prose = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) =>
      block.replace(/[^\n]/g, ' '),
    );
    for (const match of prose.matchAll(/\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g))
      add(filename, match[1], 'markdown-link', text.slice(0, match.index).split('\n').length);
    const lines = prose.split('\n');
    lines.forEach((line, index) => {
      for (const match of line.matchAll(extension)) {
        const preceding = line.slice(Math.max(0, match.index - 10), match.index);
        if (/https?:\/\/$/.test(preceding)) continue;
        if (match[0] === 'console.log') continue;
        add(filename, match[0], 'prose-or-table-filename', index + 1);
      }
    });
  } else {
    const inspect = (value, pointer = '$') => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const next = Array.isArray(value) ? `${pointer}[${key}]` : `${pointer}.${key}`;
        if (/^(log|inventory)$/i.test(key)) {
          if (typeof child === 'string') add(filename, child, 'json-log-or-inventory', next);
          else if (Array.isArray(child))
            child.forEach((item, index) => {
              if (typeof item === 'string')
                add(filename, item, 'json-log-or-inventory', `${next}[${index}]`);
            });
        } else if (
          typeof child === 'string' &&
          /^[\w./\\@%+-]+(?:\.log(?:\.txt)?|inventory[\w.-]*\.json)$/i.test(child)
        ) {
          add(filename, child, 'json-log-or-inventory', next);
        }
        inspect(child, next);
      }
    };
    if (filename.endsWith('.jsonl'))
      text
        .split('\n')
        .filter((line) => line.trim())
        .forEach((line, index) => inspect(JSON.parse(line), `$line[${index + 1}]`));
    else inspect(JSON.parse(text));
  }
}
const result = {
  on: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  checkedAt: new Date().toISOString(),
  scopes: [destination, scopes[1], `${scopes[1]}/round-2`, `${scopes[1]}/round-3`],
  policy:
    'All Markdown links and filename tokens in Markdown prose/tables, plus every JSON log/inventory string. Code fences and API calls are not prose citations. Bare TypeScript source names may resolve from explicit prose context or a unique repository suffix/basename. Artifact names are never rescued through an unrelated same-named file elsewhere; relative links must resolve at their stated location. pnpm.cmd is recorded as an installed command reference.',
  checkedFiles: files.filter(
    (name) => /\.(md|jsonl?)$/.test(name) && !name.endsWith('/round4-reference-validation.json'),
  ),
  count: references.length,
  resolved: references.filter((entry) => entry.status === 'resolved').length,
  externalOrAnchor: references.filter((entry) => entry.status === 'external-or-anchor').length,
  commandReferences: references.filter((entry) => entry.status === 'command-reference').length,
  unresolved: references.filter((entry) => entry.status === 'unresolved'),
  references,
};
// Do not silently rescue a broken Markdown link through a same-named file elsewhere.
for (const entry of references.filter(
  (item) => item.kind === 'markdown-link' && item.status === 'resolved',
)) {
  const local = path.resolve(
    path.dirname(entry.source),
    entry.value.replace(/^<|>$/g, '').replace(/#.*$/, ''),
  );
  if (!isFile(local)) {
    entry.status = 'unresolved';
    entry.reason =
      'A matching file exists elsewhere, but the actual Markdown target does not resolve.';
  }
}
result.resolved = references.filter((entry) => entry.status === 'resolved').length;
result.unresolved = references.filter((entry) => entry.status === 'unresolved');
result.unresolvedUniqueFiles = [
  ...new Set(result.unresolved.map((entry) => `${path.dirname(entry.source)}/${entry.value}`)),
];
result.scopeSummary = Object.fromEntries(
  [destination, scopes[1], `${scopes[1]}/round-2`, `${scopes[1]}/round-3`].map((scope) => {
    const entries = references.filter((entry) => path.dirname(entry.source) === scope);
    return [
      scope,
      {
        references: entries.length,
        unresolved: entries.filter((entry) => entry.status === 'unresolved').length,
      },
    ];
  }),
);
fs.writeFileSync(
  path.join(destination, 'round4-reference-validation.json'),
  JSON.stringify(result, null, 2) + '\n',
);
process.stdout.write(
  JSON.stringify(
    {
      count: result.count,
      resolved: result.resolved,
      externalOrAnchor: result.externalOrAnchor,
      commandReferences: result.commandReferences,
      unresolved: result.unresolved,
    },
    null,
    2,
  ) + '\n',
);
