/**
 * A small evaluator for `.dockerignore` rules, enough to test which paths the repository's build
 * context excludes. It follows Docker's semantics for the forms the file uses: patterns are
 * relative to the context root, a trailing `/` is dropped, `*` and `?` stay within one path
 * segment, `**` matches any number of segments, a match on a directory excludes everything below
 * it, a leading `!` re-includes, and the last matching rule wins.
 */

/** Parse the file's text into rules, skipping blank lines and comments. */
export function parseDockerignore(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const negate = line.startsWith('!');
      const pattern = (negate ? line.slice(1) : line)
        .trim()
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
      return { negate, pattern, regex: toRegex(pattern) };
    });
}

function toRegex(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      // `**/` matches zero or more leading segments; a trailing or inner `**` any characters.
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** Whether `path` (relative, `/`-separated) is excluded from the build context by `rules`. */
export function isExcluded(rules, path) {
  const segments = path.replace(/^\.\//, '').split('/');
  // A path is excluded when it or any of its parent directories matches.
  const candidates = segments.map((_, i) => segments.slice(0, i + 1).join('/'));
  let excluded = false;
  for (const rule of rules) {
    if (candidates.some((candidate) => rule.regex.test(candidate))) excluded = !rule.negate;
  }
  return excluded;
}
