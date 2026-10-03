/**
 * Licence policy evaluation, kept free of process execution so it can be unit tested.
 */

/**
 * @typedef {{ allowed: string[]; exceptions: Record<string, string> }} LicensePolicy
 * @typedef {{ name: string; versions?: string[]; license: string }} LicensedPackage
 * @typedef {{ name: string; license: string; reason: string }} LicenseViolation
 */

/**
 * Decide whether an SPDX expression is satisfied by the allowlist.
 * Handles simple expressions: "MIT", "(MIT OR Apache-2.0)", "MIT AND BSD-3-Clause", "MIT*".
 * @param {string} expression
 * @param {Set<string>} allowed
 */
export function isLicenseAllowed(expression, allowed) {
  const normalised = expression.replace(/[()]/g, ' ').replace(/\*/g, '').trim();
  if (normalised === '') return false;
  const orParts = normalised.split(/\s+OR\s+/i);
  return orParts.some((orPart) => {
    const andParts = orPart.split(/\s+AND\s+/i).map((s) => s.trim());
    return andParts.every((part) => allowed.has(part));
  });
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
    if (Object.prototype.hasOwnProperty.call(policy.exceptions, pkg.name)) continue;
    if (!isLicenseAllowed(pkg.license, allowed)) {
      violations.push({
        name: pkg.name,
        license: pkg.license,
        reason: `licence "${pkg.license}" is not in the allowlist`,
      });
    }
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
