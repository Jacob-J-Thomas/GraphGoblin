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
 * `*.md.txt`. Paths missing from this working tree (a sparse checkout) are reported and fail.
 *
 * Read-only: Git runs without optional locks and formatting is checked in memory. It complements,
 * and never replaces, `pnpm format:check` and CI. See docs/15-issue-workflow.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
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
  original: 'MD-ORIGINAL',
  retained: 'retained',
  deleted: 'deleted',
  unavailable: 'UNAVAILABLE',
};
const PROBLEMS = new Set(['unformatted', 'original', 'unavailable']);
const NOT_CHECKED_OUT = 'not in this working tree (sparse checkout or skip-worktree); not checked';
const REMOVED =
  'removed from the working tree although its addition is committed or staged; not checked';
const FIXES = {
  unformatted:
    'UNFORMATTED: format reader-facing pages before sealing their hashes with ' +
    'pnpm exec prettier --write "<path>" (add --ignore-path .gitignore when an archive ignore ' +
    'rule hides the path). Never format an immutable original: store a new one byte-for-byte ' +
    'as <name>.md.txt, or restore a historical one to its recorded bytes.',
  original:
    'MD-ORIGINAL: store an immutable Markdown original byte-for-byte as <name>.md.txt, keep the ' +
    'SHA-256 shown here in the packet manifest and link a formatted .md summary for readers.',
  unavailable:
    'UNAVAILABLE: selected paths missing from this working tree were not checked. In a sparse ' +
    'checkout run git sparse-checkout add docs/qa, or run check:qa from a full checkout; ' +
    'restore a removed file or stage its removal with git rm.',
};

function git(cwd, args) {
  return execFileSync('git', ['--no-pager', '--no-optional-locks', ...args], {
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
      const formatted = await prettier.check(bytes.toString('utf8'), {
        ...options,
        filepath: absolute,
      });
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

/** Renders the report; the result fails when any selected path has a problem. */
export function formatReport({ base, commit, mergeBase, entries }) {
  const count = (kind) => entries.filter((entry) => entry.kind === kind).length;
  const checked = count('formatted') + count('unformatted');
  const markdown = entries.filter((entry) => entry.markdown).length;
  const problems = entries.filter((entry) => PROBLEMS.has(entry.kind));
  const lines = [
    'check:qa: local QA packet pre-publication check; pnpm format:check and CI remain the full gates.',
    `Base: ${base} = ${commit}`,
    `Selection: ${QA_ROOT} paths changed from merge base ${mergeBase} to the working tree ` +
      '(committed, staged, unstaged and untracked; Git-ignored files excluded), deduplicated.',
    `Selected ${QA_ROOT} paths: ${entries.length} = checked with Prettier ${checked} ` +
      `(Markdown ${markdown}) + refused Markdown originals ${count('original')} + retained ` +
      `archived originals ${count('retained')} + deleted ${count('deleted')} + unavailable ` +
      `${count('unavailable')}`,
    ...entries.map(
      (entry) =>
        `  ${LABELS[entry.kind].padEnd(12)} ${entry.path}${entry.note ? `  [${entry.note}]` : ''}`,
    ),
  ];
  if (!entries.length) lines.push(`No ${QA_ROOT} path changed; nothing to check.`);
  for (const kind of new Set(problems.map((entry) => entry.kind))) lines.push(FIXES[kind]);
  lines.push(
    problems.length
      ? `Result: FAILED (${problems.length} problems; ${count('unavailable')} of ` +
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
