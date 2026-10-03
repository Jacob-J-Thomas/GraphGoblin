/**
 * Layer rule evaluation, kept free of filesystem access so it can be unit tested.
 */

/**
 * @typedef {{ name: string; match: string; allow: string[] | '*' }} Layer
 * @typedef {{ scope: string; ignore: string[]; layers: Layer[] }} LayerPolicy
 * @typedef {{ name: string; dependencies: Record<string, string>; location: string }} WorkspacePackage
 * @typedef {{ package: string; location: string; message: string }} Violation
 */

/**
 * Find the layer a package belongs to.
 * @param {LayerPolicy} policy
 * @param {string} packageName
 * @returns {Layer | undefined}
 */
export function findLayer(policy, packageName) {
  return policy.layers.find((layer) => new RegExp(layer.match).test(packageName));
}

/**
 * Evaluate every workspace package against the policy.
 * @param {LayerPolicy} policy
 * @param {WorkspacePackage[]} packages
 * @returns {Violation[]}
 */
export function evaluateLayers(policy, packages) {
  /** @type {Violation[]} */
  const violations = [];
  for (const pkg of packages) {
    if (policy.ignore.includes(pkg.name)) continue;
    if (!pkg.name.startsWith(policy.scope)) {
      violations.push({
        package: pkg.name,
        location: pkg.location,
        message: `package name must start with ${policy.scope}`,
      });
      continue;
    }
    const layer = findLayer(policy, pkg.name);
    if (!layer) {
      violations.push({
        package: pkg.name,
        location: pkg.location,
        message: 'package does not match any layer in tooling/layers.json',
      });
      continue;
    }
    if (layer.allow === '*') continue;
    for (const dep of Object.keys(pkg.dependencies)) {
      if (!dep.startsWith(policy.scope) || policy.ignore.includes(dep)) continue;
      if (!layer.allow.includes(dep)) {
        violations.push({
          package: pkg.name,
          location: pkg.location,
          message: `layer "${layer.name}" may not depend on ${dep} (allowed: ${
            layer.allow.length ? layer.allow.join(', ') : 'none'
          })`,
        });
      }
    }
  }
  return violations;
}

/**
 * Collect all dependency names from a package manifest.
 * @param {{ name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }} manifest
 */
export function collectDependencies(manifest) {
  return {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
}
