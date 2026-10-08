import { describe, expect, it } from 'vitest';
import { subscriptionEnvironment } from './environment.js';
describe('Claude subscription child environment', () => {
  it('copies only explicitly allowlisted Windows runtime/auth-location variables case insensitively', () => {
    expect(
      subscriptionEnvironment({
        Path: 'trusted-path',
        SystemRoot: 'system',
        USERPROFILE: 'profile',
        APPDATA: 'appdata',
        LOCALAPPDATA: 'local',
        HOME: 'home',
        TEMP: 'temp',
        TMP: 'tmp',
        COMSPEC: 'cmd',
        PATHEXT: '.EXE',
        WINDIR: 'windows',
      }),
    ).toEqual({
      PATH: 'trusted-path',
      SystemRoot: 'system',
      USERPROFILE: 'profile',
      APPDATA: 'appdata',
      LOCALAPPDATA: 'local',
      HOME: 'home',
      TEMP: 'temp',
      TMP: 'tmp',
      COMSPEC: 'cmd',
      PATHEXT: '.EXE',
      WINDIR: 'windows',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
  });
  it('never propagates API keys, tokens, providers, alternate credential/settings locations or arbitrary values', () => {
    const input = {
      ANTHROPIC_API_KEY: 'SECRET',
      ANTHROPIC_AUTH_TOKEN: 'SECRET',
      ANTHROPIC_BASE_URL: 'https://bad',
      CLAUDE_CODE_OAUTH_TOKEN: 'SECRET',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      CLAUDE_CONFIG_DIR: 'other',
      AWS_ACCESS_KEY_ID: 'SECRET',
      GOOGLE_APPLICATION_CREDENTIALS: 'SECRET',
      AZURE_API_KEY: 'SECRET',
      NODE_OPTIONS: '--require bad',
      CUSTOM: 'SECRET',
      DISABLE_AUTOUPDATER: '0',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0',
    };
    expect(subscriptionEnvironment(input)).toEqual({
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
    expect(input.ANTHROPIC_API_KEY).toBe('SECRET');
  });
});
