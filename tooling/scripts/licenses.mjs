/** Licence metadata policy evaluation; no process execution or legal certification. */

/**
 * @typedef {{ allowed: string[]; exceptions: Record<string, string>; allowGuessed?: boolean }} LicensePolicy
 * @typedef {{ name: string; versions?: string[]; license: string }} LicensedPackage
 * @typedef {LicensedPackage & { reason: string }} LicenseViolation
 * @typedef {{ kind: 'license'; id: string; exception?: string } | { kind: 'and' | 'or'; left: Expression; right: Expression }} Expression
 */

/** Parse the entire expression before evaluating any alternative. @param {string} source */
function parseExpression(source) {
  const tokens = source.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const guessed = [];
  const identifier = /^[A-Za-z0-9][A-Za-z0-9.-]*\+?\*?$/;
  /** @param {string} expected @returns {never} */
  function fail(expected) {
    throw new SyntaxError(
      `expected ${expected} at token ${position + 1}, found ${JSON.stringify(tokens[position] ?? 'end of expression')}`,
    );
  }
  /** @returns {Expression} */
  function primary() {
    if (tokens[position] === '(') {
      position++;
      const expression = or();
      if (tokens[position] !== ')') fail('closing parenthesis');
      position++;
      return expression;
    }
    const token = tokens[position];
    if (!token || ['AND', 'OR', 'WITH', ')'].includes(token) || !identifier.test(token)) {
      fail('licence ID or opening parenthesis');
    }
    position++;
    const id = token.endsWith('*') ? token.slice(0, -1) : token;
    if (token.endsWith('*')) guessed.push(token);
    if (tokens[position] !== 'WITH') return { kind: 'license', id };
    position++;
    const exception = tokens[position];
    if (
      !exception ||
      ['AND', 'OR', 'WITH'].includes(exception) ||
      !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(exception)
    ) {
      fail('exception ID after WITH');
    }
    position++;
    return { kind: 'license', id, exception };
  }
  /** AND binds more tightly than OR; WITH is parsed only on a licence ID. @returns {Expression} */
  function and() {
    let left = primary();
    while (tokens[position] === 'AND') {
      position++;
      left = { kind: 'and', left, right: primary() };
    }
    return left;
  }
  /** @returns {Expression} */
  function or() {
    let left = and();
    while (tokens[position] === 'OR') {
      position++;
      left = { kind: 'or', left, right: and() };
    }
    return left;
  }
  const expression = or();
  if (position !== tokens.length) fail('AND, OR or end of expression');
  return { expression, guessed };
}

/**
 * @param {Expression} expression
 * @param {Set<string>} allowed
 * @param {boolean} packageException
 * @returns {string[]}
 */
function disallowedReasons(expression, allowed, packageException) {
  if (expression.kind === 'license') {
    if (expression.exception) {
      const pair = `${expression.id} WITH ${expression.exception}`;
      return allowed.has(pair) ? [] : [`WITH pair "${pair}" requires an explicit allowlist entry`];
    }
    return allowed.has(expression.id) || packageException
      ? []
      : [`licence "${expression.id}" is not in the allowlist`];
  }
  const left = disallowedReasons(expression.left, allowed, packageException);
  const right = disallowedReasons(expression.right, allowed, packageException);
  return expression.kind === 'or' && (left.length === 0 || right.length === 0)
    ? []
    : [...left, ...right];
}

/**
 * @param {string} source
 * @param {Set<string>} allowed
 * @param {boolean} allowGuessed
 * @param {boolean} packageException
 */
function violationReason(source, allowed, allowGuessed, packageException) {
  try {
    const { expression, guessed } = parseExpression(source);
    if (guessed.length > 0 && !allowGuessed) {
      return `guessed licence marker requires allowGuessed: true (${guessed.join(', ')})`;
    }
    return disallowedReasons(expression, allowed, packageException).join('; ');
  } catch (error) {
    return `parse error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Decide whether a complete SPDX expression satisfies metadata policy.
 * @param {string} expression
 * @param {Set<string>} allowed
 * @param {{ allowGuessed?: boolean }} options
 */
export function isLicenseAllowed(expression, allowed, options = {}) {
  return violationReason(expression, allowed, options.allowGuessed === true, false) === '';
}

/**
 * @param {LicensePolicy} policy
 * @param {LicensedPackage[]} packages
 * @returns {LicenseViolation[]}
 */
export function evaluateLicenses(policy, packages) {
  const allowed = new Set(policy.allowed);
  /** @type {LicenseViolation[]} */
  const violations = [];
  for (const pkg of packages) {
    const reason = violationReason(
      pkg.license,
      allowed,
      policy.allowGuessed === true,
      Object.prototype.hasOwnProperty.call(policy.exceptions, pkg.name),
    );
    if (reason) violations.push({ ...pkg, reason });
  }
  return violations;
}

/**
 * Flatten the output of `pnpm licenses list --json` into one entry per package.
 * The pnpm format is an object keyed by licence string, each an array of packages.
 * @param {Record<string, Array<{ name: string; versions?: string[]; license?: string }>>} pnpmJson
 * @returns {LicensedPackage[]}
 */
export function flattenPnpmLicenses(pnpmJson) {
  /** @type {LicensedPackage[]} */
  const out = [];
  for (const [license, entries] of Object.entries(pnpmJson)) {
    for (const entry of entries) {
      out.push({
        name: entry.name,
        license: entry.license ?? license,
        ...(entry.versions ? { versions: entry.versions } : {}),
      });
    }
  }
  return out;
}
