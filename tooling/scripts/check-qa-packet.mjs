#!/usr/bin/env node
/**
 * Local pre-publication check of the QA packet paths selected for publication (#524).
 *
 * Selects the docs/qa paths that changed from the merge base of `--base` and HEAD to the working
 * tree: committed, staged, unstaged and untracked (Git-ignored files excluded), deduplicated.
 * Markdown is checked with the repository Prettier configuration even where an archive ignore rule
 * hides it from `pnpm format:check`; other files Prettier would check are checked as it would; the
 * rest are opaque archived originals, retained and reported with their SHA-256. A newly added
 * Markdown file named as an original is refused: immutable Markdown originals are stored as
 * `*.md.txt`. Paths missing from this working tree (a sparse checkout) are reported and fail. A
 * path on which Prettier stops with an error (a parse error in malformed HTML, for example) fails
 * with Prettier's own message under its path, and the remaining paths are still checked.
 *
 * Read-only: Git runs without optional locks or automatic index refresh, and formatting is checked
 * in memory. An unstaged modification is selected only when Git's patch for it is not empty, so
 * a path whose timestamp alone changed, or whose bytes Git normalizes to the indexed blob (a CRLF
 * rewrite under `text=auto eol=lf`), is not. It complements, and never replaces,
 * `pnpm format:check` and CI. See docs/15-issue-workflow.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs, stripVTControlCharacters } from 'node:util';
import * as prettier from 'prettier';

export const QA_ROOT = 'docs/qa';
const USAGE = 'Usage: pnpm check:qa --base <git-ref>   (for example --base origin/main)';
const MARKDOWN_PARSERS = new Set(['markdown', 'mdx']);

/**
 * A newly added Markdown file whose name, without its extension, ends in the word "original"
 * (`original.md`, `report.original.md`, `review-original.md`, `QA original.md`) declares itself an
 * immutable original while a Markdown extension exposes it to formatters. Only the file name of a
 * path added since the merge base is judged: historical paths, directory names and other uses of
 * the word (`original-final-audit/notes.md`, `original-hash-verification.md`) are not.
 */
export const ORIGINAL_MARKDOWN_NAME = /(?:^|[ ._-])original$/i;

const LABELS = {
  formatted: 'formatted',
  unformatted: 'UNFORMATTED',
  error: 'CHECK-ERROR',
  original: 'MD-ORIGINAL',
  retained: 'retained',
  deleted: 'deleted',
  unavailable: 'UNAVAILABLE',
};
const PROBLEMS = new Set(['unformatted', 'error', 'original', 'unavailable']);
const NOT_CHECKED_OUT = 'not in this working tree (sparse checkout or skip-worktree); not checked';
const REMOVED =
  'removed from the working tree although its addition is committed or staged; not checked';
const PRETTIER_STOPPED = 'Prettier stopped with an error; not checked, see its detail below';
/** Line breaks in a Prettier message, as its code frame splits source lines. */
const LINE_BREAK = /\r\n|[\n\r\p{Zl}\p{Zp}]/u;
const FIXES = {
  unformatted:
    'UNFORMATTED: format reader-facing pages before sealing their hashes with ' +
    'pnpm exec prettier --write "<path>" (add --ignore-path .gitignore when an archive ignore ' +
    'rule hides the path). Never format an immutable original: store a new one byte-for-byte ' +
    'as <name>.md.txt, or restore a historical one to its recorded bytes.',
  error:
    'CHECK-ERROR: Prettier stopped with an error on a selected path, so its formatting was not ' +
    'checked; its message is shown above under the path. Correct the cause it reports at the ' +
    'line and column given, then run check:qa again. Never edit an immutable original to ' +
    'satisfy Prettier: keep its recorded bytes as the QA packet file conventions in ' +
    'docs/15-issue-workflow.md describe.',
  original:
    'MD-ORIGINAL: store an immutable Markdown original byte-for-byte as <name>.md.txt, keep the ' +
    'SHA-256 shown here in the packet manifest and link a formatted .md summary for readers.',
  unavailable:
    'UNAVAILABLE: selected paths missing from this working tree were not checked. In a sparse ' +
    'checkout run git sparse-checkout add docs/qa, or run check:qa from a full checkout; ' +
    'restore a removed file or stage its removal with git rm.',
};

/**
 * Runs Git read-only, with pathspecs taken literally. Optional locks cover `git status`, not the
 * stat refresh `git diff` writes to the index after comparing stale entries, so each invocation
 * switches that refresh off with `-c`, leaving repository and global Git configuration unchanged.
 */
function git(cwd, args) {
  const readOnly = [
    '--no-pager',
    '--no-optional-locks',
    '--literal-pathspecs',
    '-c',
    'diff.autoRefreshIndex=false',
  ];
  return execFileSync('git', [...readOnly, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args).trim();
  } catch {
    return '';
  }
}

/** Parses `--name-status -z` output (renames disabled) into path -> status letter. */
function nameStatus(output) {
  const fields = output.split('\0');
  const statuses = new Map();
  for (let index = 0; index + 1 < fields.length; index += 2)
    statuses.set(fields[index + 1], fields[index][0]);
  return statuses;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Selects and classifies the docs/qa paths a publication from `cwd` would carry relative to
 * `base`. Throws with an actionable message when the repository, base or merge base is unusable.
 */
export async function checkQaPacket({ base, cwd = process.cwd() }) {
  const top = tryGit(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) throw new Error(`check:qa must run inside a Git working tree; ${cwd} is not in one.`);
  const root = resolve(top);
  const commit =
    !base.startsWith('-') && tryGit(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (!commit)
    throw new Error(
      `--base ${JSON.stringify(base)} does not name a commit in this repository. ` +
        'Fetch it first or pass an existing ref such as origin/main.',
    );
  const mergeBase = tryGit(root, ['merge-base', commit, 'HEAD']);
  if (!mergeBase)
    throw new Error(
      `${base} and HEAD share no merge base. Fetch the missing history (for example ` +
        'git fetch --unshallow) or pass a base this branch descends from.',
    );

  const diff = ['diff', '--name-status', '-z', '--no-renames', '--no-color'];
  const staged = nameStatus(git(root, [...diff, '--cached', mergeBase, '--', QA_ROOT]));
  const unstaged = nameStatus(git(root, [...diff, '--', QA_ROOT]));
  // Without its index refresh, `git diff` lists every entry whose cached stat data is stale, and
  // no cached predicate settles whether its content changed: Git's own check skips the content
  // when the cached size differs, as after a CRLF rewrite that normalizes to the indexed blob.
  // To build a patch, Git hashes the work-tree file as it would store it (attributes, end-of-line
  // normalization, the index) and compares contents, so a path whose stored content would not
  // change yields an empty patch and is dropped. Paths staged or committed are selected anyway.
  const patch = ['diff', '--patch', '--no-ext-diff', '--no-textconv', '--no-color', '--'];
  for (const [path, status] of unstaged)
    if (status === 'M' && !staged.has(path) && !git(root, [...patch, path])) unstaged.delete(path);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', QA_ROOT])
    .split('\0')
    .filter(Boolean);
  const paths = [...new Set([...staged.keys(), ...unstaged.keys(), ...untracked])].sort();

  const ignoreFiles = [join(root, '.gitignore'), join(root, '.prettierignore')];
  const entries = [];
  for (const path of paths) {
    const absolute = join(root, path);
    // An index entry the staged comparison omits equals the merge base's; untracked paths are new.
    const inBase = (staged.get(path) ?? unstaged.get(path) ?? 'A') !== 'A';
    const present = await stat(absolute).then(
      (entry) => entry.isFile(),
      () => false,
    );
    if (!present) {
      const removed = staged.get(path) === 'D' || unstaged.get(path) === 'D';
      entries.push(
        removed && inBase
          ? { path, kind: 'deleted' }
          : { path, kind: 'unavailable', note: removed ? REMOVED : NOT_CHECKED_OUT },
      );
      continue;
    }
    const bytes = await readFile(absolute);
    const { inferredParser } = await prettier.getFileInfo(absolute, {
      ignorePath: [],
      withNodeModules: true,
    });
    // The same ignore files `prettier --check .` reads from the repository root.
    const { ignored } = await prettier.getFileInfo(absolute, { ignorePath: ignoreFiles });
    const markdown = MARKDOWN_PARSERS.has(inferredParser);
    const stem = basename(path).replace(/\.[^.]*$/, '');
    if (markdown && !inBase && ORIGINAL_MARKDOWN_NAME.test(stem)) {
      entries.push({ path, kind: 'original', note: `sha256=${sha256(bytes)}` });
    } else if (markdown || (inferredParser && !ignored)) {
      const options = await prettier.resolveConfig(absolute, { editorconfig: true });
      let formatted;
      try {
        formatted = await prettier.check(bytes.toString('utf8'), {
          ...options,
          filepath: absolute,
        });
      } catch (error) {
        // Prettier gave no format verdict for this path, whatever its reason. That fails this path
        // with Prettier's message as its CLI prints it, never as a run that could not start, and
        // the remaining paths are still checked.
        entries.push({ path, kind: 'error', note: PRETTIER_STOPPED, detail: String(error) });
        continue;
      }
      entries.push({
        path,
        kind: formatted ? 'formatted' : 'unformatted',
        markdown,
        note: ignored ? 'an ignore rule hides it from format:check; checked here' : '',
      });
    } else {
      entries.push({ path, kind: 'retained', note: `sha256=${sha256(bytes)}` });
    }
  }
  return { base, commit, mergeBase, entries };
}

/**
 * Renders the report; the result fails when any selected path has a problem. The counts partition
 * the selected paths: a Prettier error is neither a completed check nor an unavailable path, and
 * its term appears only when one occurred, leaving every other report unchanged.
 */
export function formatReport({ base, commit, mergeBase, entries }) {
  const count = (kind) => entries.filter((entry) => entry.kind === kind).length;
  const checked = count('formatted') + count('unformatted');
  const markdown = entries.filter((entry) => entry.markdown).length;
  const errors = entries.filter((entry) => entry.kind === 'error');
  const problems = entries.filter((entry) => PROBLEMS.has(entry.kind));
  const lines = [
    'check:qa: local QA packet pre-publication check; pnpm format:check and CI remain the full gates.',
    `Base: ${base} = ${commit}`,
    `Selection: ${QA_ROOT} paths changed from merge base ${mergeBase} to the working tree ` +
      '(committed, staged, unstaged and untracked; Git-ignored files excluded), deduplicated.',
    `Selected ${QA_ROOT} paths: ${entries.length} = checked with Prettier ${checked} ` +
      `(Markdown ${markdown})${errors.length ? ` + Prettier errors ${errors.length}` : ''} + ` +
      `refused Markdown originals ${count('original')} + retained archived originals ` +
      `${count('retained')} + deleted ${count('deleted')} + unavailable ${count('unavailable')}`,
    ...entries.map(
      (entry) =>
        `  ${LABELS[entry.kind].padEnd(12)} ${entry.path}${entry.note ? `  [${entry.note}]` : ''}`,
    ),
    // Prettier's message and code frame, without terminal colour, under a line naming the path.
    // Every detail line starts with an indented bar, so no frame line can read as a path row.
    ...errors.flatMap((entry) => [
      `CHECK-ERROR detail for ${entry.path}:`,
      ...stripVTControlCharacters(entry.detail)
        .split(LINE_BREAK)
        .map((line) => `    | ${line}`),
    ]),
  ];
  if (!entries.length) lines.push(`No ${QA_ROOT} path changed; nothing to check.`);
  for (const kind of new Set(problems.map((entry) => entry.kind))) lines.push(FIXES[kind]);
  lines.push(
    problems.length
      ? `Result: FAILED (${problems.length} problems; ${count('unavailable') + errors.length} of ` +
          `${entries.length} selected paths not checked).`
      : 'Result: passed (every selected path was checked, retained or deleted).',
  );
  return { text: lines.join('\n'), exitCode: problems.length ? 1 : 0 };
}

/** Command entry: 0 passed, 1 a selected path failed, 2 the check could not run. */
export async function main(args = process.argv.slice(2), cwd = process.cwd()) {
  try {
    let values;
    try {
      ({ values } = parseArgs({ args, options: { base: { type: 'string' } }, strict: true }));
    } catch (error) {
      throw new Error(`${error.message}\n${USAGE}`, { cause: error });
    }
    if (!values.base) throw new Error(USAGE);
    const report = formatReport(await checkQaPacket({ base: values.base, cwd }));
    console.log(report.text);
    return report.exitCode;
  } catch (error) {
    console.error(`check:qa: ${error.message}`);
    return 2;
  }
}

if (import.meta.main) process.exitCode = await main();
