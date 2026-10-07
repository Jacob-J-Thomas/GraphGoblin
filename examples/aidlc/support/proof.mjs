import { assert, branchGuard, sha } from './core.mjs';

export const hashObjectArgs = (file) => ['hash-object', '-w', '--', file];

// Always refresh the tracking ref: a new clone must extend the published history.
export function proofParent(branch, config, git, optionalGit) {
  branchGuard(branch, config);
  const remote = `refs/heads/${branch}`;
  const tracking = `refs/remotes/origin/${branch}`;
  const advertised = git('ls-remote', '--heads', '--', 'origin', remote);
  if (advertised) {
    git('fetch', '--', 'origin', `${remote}:${tracking}`);
    const parent = git('rev-parse', '--verify', '--end-of-options', tracking);
    assert(sha(parent), 'PROOF_PARENT_INVALID');
    return parent;
  }
  const local = optionalGit(['rev-parse', '--verify', '--end-of-options', remote]);
  return local.status === 0 ? local.stdout.trim() : null;
}
