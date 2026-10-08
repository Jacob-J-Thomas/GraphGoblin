/** Subscription authentication uses the installed login, never inherited provider credentials. */
const ALLOWED_ENVIRONMENT = [
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'PATH',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
] as const;
export function subscriptionEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ALLOWED_ENVIRONMENT) {
    const key = Object.keys(source).find(
      (candidate) => candidate.toUpperCase() === name.toUpperCase(),
    );
    if (key !== undefined && source[key] !== undefined) environment[name] = source[key];
  }
  return {
    ...environment,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}
