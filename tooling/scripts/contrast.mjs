/** WCAG 2.x contrast evaluation and Markdown rendering, with no I/O. */

/** @typedef {{ text: string[][]; nonText: string[][]; decorative: string[][] }} ContrastPairs */

/** Read top-level theme rules; conditional rules are not explicit theme definitions. @param {string} css */
export function readThemes(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open < 0) break;
    const selector = source.slice(index, open).trim().split(/[;}]/).pop().trim();
    let end = open + 1;
    let depth = 1;
    while (depth > 0 && end < source.length) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}') depth -= 1;
      end += 1;
    }
    if (depth !== 0) throw new Error('Unclosed CSS rule in tokens file');
    if (!selector.startsWith('@')) {
      const tokens = {};
      for (const match of source.slice(open + 1, end - 1).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
        tokens[match[1]] = match[2].trim();
      }
      rules.push({ selectors: selector.split(',').map((s) => s.trim()), tokens });
    }
    index = end;
  }
  const base = {};
  for (const rule of rules) {
    if (rule.selectors.includes(':root')) Object.assign(base, rule.tokens);
  }
  const themes = { dark: { ...base }, light: { ...base } };
  for (const name of ['dark', 'light']) {
    for (const rule of rules) {
      if (
        rule.selectors.some((selector) =>
          new RegExp(`^(?::root|html)?\\[data-theme\\s*=\\s*['"]?${name}['"]?\\]$`).test(selector),
        )
      ) {
        Object.assign(themes[name], rule.tokens);
      }
    }
  }
  return themes;
}

/** Resolve primitive/semantic aliases, including var() fallback aliases. @param {Record<string, string>} tokens @param {string} name @param {Set<string>} [seen] */
export function resolveToken(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Circular token ${name}`);
  const value = tokens[name];
  if (value === undefined) throw new Error(`Unknown token ${name}`);
  return resolveValue(tokens, value, new Set([...seen, name]));
}

/** @param {Record<string, string>} tokens @param {string} value @param {Set<string>} seen */
function resolveValue(tokens, value, seen) {
  const reference = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value);
  if (!reference) return value;
  if (tokens[reference[1]] === undefined && reference[2]) {
    return resolveValue(tokens, reference[2].trim(), seen);
  }
  return resolveToken(tokens, reference[1], seen);
}

/** The approved palette uses opaque sRGB hex. Fail closed for unsupported/alpha values. @param {string} hex */
export function luminance(hex) {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Contrast needs an opaque #rgb or #rrggbb colour, received: ${hex}`);
  const digits =
    match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
  const number = parseInt(digits, 16);
  const channel = (value) => {
    const normalised = value / 255;
    return normalised <= 0.04045 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((number >> 16) & 255) +
    0.7152 * channel((number >> 8) & 255) +
    0.0722 * channel(number & 255)
  );
}

/** @param {string} foreground @param {string} background */
export function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** @param {unknown} pairs @returns {asserts pairs is ContrastPairs} */
export function validatePairs(pairs) {
  if (!pairs || typeof pairs !== 'object') throw new Error('Contrast pairs must be an object');
  for (const group of ['text', 'nonText', 'decorative']) {
    if (!Array.isArray(pairs[group]) || pairs[group].length === 0) {
      throw new Error(`Contrast pairs need a nonempty ${group} list`);
    }
    for (const pair of pairs[group]) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 3 ||
        pair.some((value) => typeof value !== 'string' || !value.trim()) ||
        !/^--[\w-]+$/.test(pair[0]) ||
        !/^--[\w-]+$/.test(pair[1])
      ) {
        throw new Error(
          `Invalid ${group} pair: expected [foreground token, background token, where]`,
        );
      }
    }
  }
}

/** Escape Markdown table cells. @param {string} text */
function cell(text) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** @param {string} css @param {ContrastPairs} pairs @param {string} [source] */
export function contrastReport(css, pairs, source = 'apps/web/src/styles/tokens.css') {
  validatePairs(pairs);
  const themes = readThemes(css);
  for (const tokens of Object.values(themes)) {
    for (const surface of Object.keys(tokens).filter((name) => name.startsWith('--surface-'))) {
      if (!pairs.nonText.some(([fg, bg]) => fg === '--focus-ring' && bg === surface)) {
        throw new Error(
          `Missing non-text focus-ring pair for ${surface} in design-contrast.pairs.json`,
        );
      }
    }
  }
  const failures = [];
  const summaries = [];
  const sections = [];
  for (const name of ['dark', 'light']) {
    const groups = [
      { title: 'Text (4.5:1)', pairs: pairs.text, minimum: 4.5 },
      { title: 'Non-text (3:1)', pairs: pairs.nonText, minimum: 3 },
      { title: 'Decorative (not enforced)', pairs: pairs.decorative, minimum: undefined },
    ].map((group) => ({
      ...group,
      rows: group.pairs.map(([fg, bg, where]) => {
        const a = resolveToken(themes[name], fg);
        const b = resolveToken(themes[name], bg);
        const ratio = contrastRatio(a, b);
        const pass = group.minimum === undefined || ratio >= group.minimum;
        const row = { theme: name, fg, bg, a, b, ratio, where, pass };
        if (!pass) failures.push(row);
        return row;
      }),
    }));
    const lowest = (rows) => {
      const row = rows.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      return `${row.ratio.toFixed(2)}:1 (\`${row.fg}\` on \`${row.bg}\`)`;
    };
    summaries.push(
      `- ${name}: ${groups[0].rows.length} text pairs (${groups[0].rows.filter((r) => !r.pass).length} below 4.5:1), ${groups[1].rows.length} non-text pairs (${groups[1].rows.filter((r) => !r.pass).length} below 3:1). Lowest text ${lowest(groups[0].rows)}; lowest non-text ${lowest(groups[1].rows)}.`,
    );
    const tables = groups.map((group) => {
      const rows = group.rows.map(
        (row) =>
          `| \`${row.fg}\` ${row.a} | \`${row.bg}\` ${row.b} | ${row.ratio.toFixed(2)}:1 | ${group.minimum === undefined ? 'decorative' : row.pass ? 'pass' : `**FAIL** (< ${group.minimum}:1)`} | ${cell(row.where)} |`,
      );
      return `### ${group.title}\n\n| Foreground | Background | Ratio | Result | Where |\n| --- | --- | ---: | --- | --- |\n${rows.join('\n')}\n`;
    });
    sections.push(`## ${name[0].toUpperCase()}${name.slice(1)} theme\n\n${tables.join('\n')}`);
  }
  const markdown = `# Design token contrast

Generated by \`pnpm docs:contrast\` from \`${source}\`; do not edit by hand. Pairs are defined in \`tooling/scripts/design-contrast.pairs.json\`. Ratios use the WCAG 2.x relative-luminance formula for opaque sRGB colours. Every pair runs in both themes. Text needs 4.5:1 (WCAG 1.4.3); non-text needs 3:1 (WCAG 1.4.11: control boundaries, focus rings, state indicators, meaningful graphics). Decorative pairs are listed for information only.

${summaries.join('\n')}

${sections.join('\n')}`;
  return { markdown, failures };
}
