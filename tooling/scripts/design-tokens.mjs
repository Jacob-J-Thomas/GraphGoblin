/**
 * Static design-token policy, free of filesystem access. Match complete Tailwind
 * candidates and literals in colour declarations, not arbitrary words or hex ids.
 * This is a lexical check; it does not evaluate JavaScript or trace computed values.
 */

/** @typedef {{ file: string; line: number; text: string }} TokenViolation */
/** @typedef {{ file: string; name: string; declaration: string }} TokenException */

const PALETTE =
  /^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|lightBlue|warmGray|trueGray|coolGray|blueGray)-\d+$/;
const UTILITY =
  /^(?:bg|text|border(?:-[xytrblse])?|divide(?:-[xy])?|ring(?:-offset)?|outline|shadow|fill|stroke|accent|caret|decoration|from|via|to|placeholder)-(.+)$/;
const FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'oklch', 'oklab', 'lab', 'lch', 'color']);
const NAMED = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
  blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk
  crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
  darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
  dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite
  gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
  lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
  magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
  mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
  mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
  powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
  seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen
  steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`
    .split(/\s+/)
    .filter(Boolean),
);

/** The directory exclusion is the only broad allowlist. @param {string} file */
export function shouldScanTokens(file) {
  const path = file.replace(/\\/g, '/');
  if (path === 'apps/web/index.html' || path === 'apps/web/vite.config.ts') return true;
  return (
    path.startsWith('apps/web/src/') &&
    !path.startsWith('apps/web/src/styles/') &&
    !path.split('/').includes('__fixtures__') &&
    !/\.test\./.test(path) &&
    /\.(?:ts|tsx|css)$/.test(path)
  );
}

/** Remove comments without moving offsets or treating URLs in strings as comments. @param {string} source */
export function maskComments(source) {
  return source.replace(
    /(['"`])(?:\\[\s\S]|(?!\1)[^\\])*?\1|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|<!--[\s\S]*?-->/g,
    (text) => (/^(?:\/\*|\/\/|<!--)/.test(text) ? text.replace(/[^\r\n]/g, ' ') : text),
  );
}

/** @param {string} property */
function colourProperty(property) {
  const name = property
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/_/g, '-');
  return /^(?:color|background(?:-color|-image)?|border(?:-(?:[a-z-]+))?|outline(?:-color)?|(?:box|text)-shadow|fill|stroke|(?:stop|flood|lighting|caret|accent|theme)-color|text-decoration(?:-color)?|text-emphasis(?:-color)?|filter)$/.test(
    name,
  );
}

/** Find colour syntax, ignoring CSS strings, URLs and custom-property identifiers. @param {string} value */
export function colourLiterals(value) {
  const visible = value.replace(/url\([^)]*\)|(['"])(?:\\[\s\S]|(?!\1)[^\\])*?\1/g, (text) =>
    ' '.repeat(text.length),
  );
  const found = [];
  const atoms = /#[\da-f]+\b|--[\w-]+|[a-z][\w-]*/gi;
  for (const match of visible.matchAll(atoms)) {
    const text = match[0];
    if (/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(text)) {
      found.push({ index: match.index, text });
    } else if (FUNCTIONS.has(text.toLowerCase()) && visible[match.index + text.length] === '(') {
      let end = match.index + text.length;
      let depth = 0;
      do {
        if (visible[end] === '(') depth += 1;
        if (visible[end] === ')') depth -= 1;
        end += 1;
      } while (depth > 0 && end < visible.length);
      found.push({ index: match.index, text: value.slice(match.index, end) });
    } else if (NAMED.has(text.toLowerCase())) {
      found.push({ index: match.index, text });
    }
  }
  return found;
}

/** Split candidates outside arbitrary-value brackets, retaining their source offsets. @param {string} source */
function candidates(source) {
  const result = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index];
    if (char === '[') depth += 1;
    if (char === ']') depth = Math.max(0, depth - 1);
    if (index === source.length || (depth === 0 && /[\s'"`{};,=<>]/.test(char))) {
      if (index > start) result.push({ index: start, text: source.slice(start, index) });
      start = index + 1;
    }
  }
  return result;
}

/** Remove variants only at bracket depth zero (arbitrary variants can contain colons). @param {string} candidate */
export function isRawColourClass(candidate) {
  let start = 0;
  let depth = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] === '[') depth += 1;
    if (candidate[index] === ']') depth -= 1;
    if (candidate[index] === ':' && depth === 0) start = index + 1;
  }
  const utility = candidate.slice(start).replace(/^!|!$/g, '');
  const arbitrary = /^\[([\w-]+):(.+)\]$/.exec(utility);
  if (arbitrary)
    return (
      (colourProperty(arbitrary[1]) || arbitrary[1].startsWith('--')) &&
      colourLiterals(arbitrary[2].replace(/_/g, ' ')).length > 0
    );
  const match = UTILITY.exec(utility);
  if (!match) return false;
  const value = match[1];
  if (value.startsWith('[')) {
    const close = value.lastIndexOf(']');
    return close > 0 && colourLiterals(value.slice(1, close).replace(/_/g, ' ')).length > 0;
  }
  const colour = value.split('/')[0];
  return PALETTE.test(colour) || colour === 'white' || colour === 'black';
}

/**
 * @param {string} source
 * @param {string} file repository-relative path
 * @param {TokenException[]} [exceptions] one exact, named declaration per config file
 * @returns {TokenViolation[]}
 */
export function scanDesignTokens(source, file, exceptions = []) {
  if (!shouldScanTokens(file)) return [];
  const visible = maskComments(source);
  const allowed = exceptions.filter((exception) => exception.file === file);
  if (
    allowed.length > 1 ||
    allowed.some(
      (exception) =>
        !['apps/web/index.html', 'apps/web/vite.config.ts'].includes(file) ||
        !exception.name ||
        !/^[\w-]+$/.test(exception.name) ||
        !exception.declaration ||
        (file.endsWith('.ts')
          ? !new RegExp(
              `^(?:export\\s+)?const\\s+${exception.name}\\s*=\\s*(['"])#(?:[\\da-f]{3}|[\\da-f]{6}|[\\da-f]{8})\\1;?$`,
              'i',
            ).test(exception.declaration)
          : !/^<meta\b[^>]*\bname=['"]theme-color['"][^>]*>$/i.test(exception.declaration)),
    )
  ) {
    throw new Error('Token exceptions require one named, exact declaration per config file');
  }
  const ranges = allowed.flatMap((exception) => {
    const start = visible.indexOf(exception.declaration);
    if (start < 0) return [];
    if (visible.indexOf(exception.declaration, start + 1) >= 0) {
      throw new Error(`Token exception ${exception.name} matches more than once`);
    }
    return [{ start, end: start + exception.declaration.length }];
  });
  /** @type {Map<number, TokenViolation>} */
  const found = new Map();
  const add = (index, text) => {
    if (ranges.some((range) => index >= range.start && index + text.length <= range.end)) return;
    found.set(index, { file, line: source.slice(0, index).split('\n').length, text });
  };
  const classes = (value, offset) => {
    for (const candidate of candidates(value)) {
      if (isRawColourClass(candidate.text)) add(offset + candidate.index, candidate.text);
    }
  };
  const declarations = (body, offset) => {
    for (const match of body.matchAll(/(?:^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]+)/g)) {
      if (!colourProperty(match[1]) && !match[1].startsWith('--')) continue;
      const start = match.index + match[0].indexOf(':') + 1;
      const value = body.slice(start, match.index + match[0].length);
      for (const literal of colourLiterals(value))
        add(offset + start + literal.index, literal.text);
    }
  };
  if (file.endsWith('.css')) {
    declarations(visible, 0);
    for (const match of visible.matchAll(/@apply\s+([^;{}]+)/g)) {
      classes(match[1], match.index + match[0].indexOf(match[1]));
    }
  } else {
    for (const match of visible.matchAll(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*?\1/g)) {
      const prefix = visible.slice(0, match.index);
      const property = /(?:['"]([\w-]+)['"]|([\w-]+))\s*[:=]\s*(?:\{\s*)?$/.exec(prefix);
      const name = property?.[1] ?? property?.[2] ?? '';
      const value = match[0].slice(1, -1);
      classes(value, match.index + 1);
      if (colourProperty(name) || /(?:Color|Colour|_COLOR|_COLOUR)$/.test(name)) {
        for (const literal of colourLiterals(value))
          add(match.index + 1 + literal.index, literal.text);
      }
      if (name === 'style' || /(?:css|styled(?:\.\w+)?)\s*$/.test(prefix)) {
        declarations(value, match.index + 1);
      }
    }
    for (const meta of visible.matchAll(/<meta\b[^>]*>/gi)) {
      if (!/\bname\s*=\s*['"]theme-color['"]/i.test(meta[0])) continue;
      const content = /\bcontent\s*=\s*(['"])(.*?)\1/i.exec(meta[0]);
      if (!content) continue;
      const start = meta.index + content.index + content[0].indexOf(content[1]) + 1;
      for (const literal of colourLiterals(content[2])) add(start + literal.index, literal.text);
    }
  }
  return [...found.entries()].sort(([a], [b]) => a - b).map(([, violation]) => violation);
}
