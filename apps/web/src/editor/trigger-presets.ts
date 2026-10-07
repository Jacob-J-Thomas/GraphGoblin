export const GITHUB_TRIGGER_PRESETS = [
  { id: 'issues-labeled', label: 'Webhook: issue gets a label' },
  { id: 'pull-request-ready', label: 'Webhook: pull request opened or marked ready' },
  { id: 'pull-request-merged', label: 'Webhook: pull request merged' },
  { id: 'issues-poll', label: 'Poll: open issues with a label' },
] as const;

export type GitHubTriggerPreset = (typeof GITHUB_TRIGGER_PRESETS)[number]['id'];

export interface GitHubTriggerSetup {
  owner: string;
  repository: string;
  label: string;
  baseBranch: string;
  secretRef: string;
}

/** Validate the values used in a GitHub repo path before they become an editable gh command. */
export function validGitHubRepository(owner: string, repository: string): boolean {
  return (
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner.trim()) &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(repository.trim())
  );
}

export function canApplyGitHubPreset(
  preset: GitHubTriggerPreset | '',
  setup: GitHubTriggerSetup,
): boolean {
  if (!preset || !validGitHubRepository(setup.owner, setup.repository)) return false;
  if (preset === 'issues-labeled' || preset === 'issues-poll')
    if (!setup.label.trim() || setup.label.trim().length > 255) return false;
  if (preset === 'pull-request-ready' || preset === 'pull-request-merged')
    if (!setup.baseBranch.trim() || setup.baseBranch.trim().length > 255) return false;
  if (preset !== 'issues-poll' && (!setup.secretRef.trim() || setup.secretRef.trim().length > 128))
    return false;
  return true;
}

function jsonataString(value: string): string {
  return JSON.stringify(value) ?? '""';
}

function repositoryFilter(setup: GitHubTriggerSetup): string {
  return `repository.full_name = ${jsonataString(`${setup.owner.trim()}/${setup.repository.trim()}`)}`;
}

function bodyWebhook(filter: string, setup: GitHubTriggerSetup): Record<string, unknown> {
  return {
    subtype: 'webhook',
    signature: {
      scheme: 'hmac-sha256-body',
      header: 'x-hub-signature-256',
      secretRef: setup.secretRef.trim(),
    },
    dedupeKey: '$headers."x-github-delivery"',
    filter,
  };
}

function githubIssuePollProgram(endpoint: string): string {
  const query =
    '.[] | select(.pull_request == null) | {number,title,updated_at,url:.html_url} | @json';
  return [
    "const {spawnSync}=require('node:child_process');",
    "const fail=()=>{process.stderr.write('GitHub poll failed or exceeded limits');process.exit(1)};",
    `const result=spawnSync('gh',['api','--method','GET','--paginate',${JSON.stringify(endpoint)},'--jq',${JSON.stringify(query)}],{encoding:'utf8',maxBuffer:65536,timeout:55000,windowsHide:true,shell:false});`,
    'if(result.error||result.status!==0)fail();',
    "try{const lines=result.stdout.split(/\\r?\\n/).filter(line=>line.trim()!=='');if(lines.length>200)fail();const items=lines.map(line=>JSON.parse(line,(_,value)=>{if(typeof value==='number'&&!Number.isFinite(value))throw new Error();return value}));const output=JSON.stringify(items);if(Buffer.byteLength(output,'utf8')>65536)fail();process.stdout.write(output)}catch{fail()}",
  ].join('');
}

/** The preset is only a starting config; the editor keeps every generated value editable. */
export function makeGitHubTriggerPreset(
  preset: GitHubTriggerPreset,
  setup: GitHubTriggerSetup,
): Record<string, unknown> {
  const repository = repositoryFilter(setup);
  if (preset === 'issues-labeled') {
    return bodyWebhook(
      `${repository} and action = "labeled" and $exists(issue) and $not($exists(issue.pull_request)) and label.name = ${jsonataString(setup.label.trim())}`,
      setup,
    );
  }
  if (preset === 'pull-request-ready') {
    return bodyWebhook(
      `${repository} and action in ["opened", "ready_for_review"] and $exists(pull_request) and pull_request.draft = false and pull_request.base.ref = ${jsonataString(setup.baseBranch.trim())}`,
      setup,
    );
  }
  if (preset === 'pull-request-merged') {
    return bodyWebhook(
      `${repository} and action = "closed" and $exists(pull_request) and pull_request.merged = true and pull_request.base.ref = ${jsonataString(setup.baseBranch.trim())}`,
      setup,
    );
  }

  const owner = setup.owner.trim();
  const repo = setup.repository.trim();
  const label = encodeURIComponent(setup.label.trim());
  const endpoint = `repos/${owner}/${repo}/issues?state=open&labels=${label}&per_page=100`;
  return {
    subtype: 'poll',
    intervalSeconds: 60,
    probe: {
      kind: 'script',
      command: 'node',
      args: ['-e', githubIssuePollProgram(endpoint)],
      timeoutSeconds: 60,
    },
    fireWhen: 'true',
    items: {
      select: 'probe.json',
      dedupeKey: `${jsonataString(`${owner}/${repo}:issue:`)} & $string(item.number)`,
      maxRunsPerPoll: 5,
    },
    enabled: true,
  };
}

/** Surface unrecognized stored signing values; never reinterpret them as a supported scheme. */
export function unsupportedSigningScheme(config: unknown): string | undefined {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return undefined;
  const trigger = config as Record<string, unknown>;
  if (trigger['subtype'] !== 'webhook') return undefined;
  const signature = trigger['signature'];
  if (typeof signature !== 'object' || signature === null || Array.isArray(signature))
    return undefined;
  const scheme = (signature as Record<string, unknown>)['scheme'];
  if (typeof scheme !== 'string' || scheme === 'hmac-sha256' || scheme === 'hmac-sha256-body')
    return undefined;
  return scheme;
}
