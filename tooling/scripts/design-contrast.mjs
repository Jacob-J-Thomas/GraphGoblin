#!/usr/bin/env node
/** Generate/check the contrast table. The pure evaluation lives in contrast.mjs. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastReport } from './contrast.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

try {
  const args = process.argv.slice(2);
  let tokens = process.env['GG_DESIGN_TOKENS'] ?? join(root, 'apps/web/src/styles/tokens.css');
  let output = join(root, 'docs/qa/design-contrast.md');
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--check') check = true;
    else if (['--tokens', '--output'].includes(args[index]) && args[index + 1]) {
      if (args[index] === '--tokens') tokens = args[++index];
      else output = args[++index];
    } else {
      throw new Error(
        'Usage: node tooling/scripts/design-contrast.mjs [--check] [--tokens <css>] [--output <md>]',
      );
    }
  }
  tokens = resolve(tokens);
  output = resolve(output);
  let css;
  try {
    css = readFileSync(tokens, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read design tokens at ${tokens}; supply --tokens <css> or GG_DESIGN_TOKENS`,
      { cause: error },
    );
  }
  const pairs = JSON.parse(readFileSync(join(here, 'design-contrast.pairs.json'), 'utf8'));
  const source = relative(root, tokens).replace(/\\/g, '/');
  const result = contrastReport(css, pairs, source);
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(output)) ?? {};
  const markdown = await prettier.format(result.markdown, { ...options, filepath: output });
  let stale = false;
  if (check) {
    let committed = '';
    try {
      committed = readFileSync(output, 'utf8').replace(/\r\n/g, '\n');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    stale = committed !== markdown;
    if (stale)
      console.error(`Contrast table is missing or stale: ${output}; run pnpm docs:contrast`);
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, markdown, 'utf8');
  }
  for (const failure of result.failures) {
    console.error(
      `FAIL ${failure.theme} ${failure.fg} on ${failure.bg}: ${failure.ratio.toFixed(2)}:1`,
    );
  }
  console.error(
    `Design contrast: ${result.failures.length} failing enforced pair(s)${stale ? '; table stale' : ''}`,
  );
  process.exitCode = stale || result.failures.length > 0 ? 1 : 0;
} catch (error) {
  console.error('Design contrast failed:', error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
