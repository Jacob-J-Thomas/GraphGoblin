// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import eslintReact from '@eslint-react/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      // Playwright traces contain copies of built bundles, not authored source.
      '**/test-results/**',
      // Generated code (for example the OpenAPI types in packages/api-client) is not linted.
      '**/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/packages/*', '**/apps/*', '../../../*'],
              message:
                'Reach other workspace packages only through their @graphgoblin/* entry points.',
            },
          ],
        },
      ],
    },
  },
  {
    // React (apps/web): JSX and DOM rules from @eslint-react (type-aware preset) plus the hooks rules.
    files: ['apps/web/**/*.tsx'],
    ...eslintReact.configs['recommended-type-checked'],
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // eslint-plugin-react-hooks owns the hooks rules; @eslint-react's duplicate is turned off.
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/rules-of-hooks': 'off',
      // Form arrays are addressed by index (react-hook-form paths are index based), and the other
      // lists are derived, read-only renders, so an index is the correct key.
      '@eslint-react/no-array-index-key': 'off',
      // Browser code reaches the backend only through @graphgoblin/api-client (docs/09).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@graphgoblin/engine', message: 'The web app must not import the engine.' },
            {
              name: '@graphgoblin/infrastructure',
              message: 'The web app must not import Node infrastructure.',
            },
          ],
          patterns: [
            {
              group: ['@graphgoblin/engine/*', '@graphgoblin/infrastructure/*'],
              message: 'The web app must not import the engine or Node infrastructure.',
            },
            {
              group: ['**/packages/*', '**/apps/*', '../../../*'],
              message:
                'Reach other workspace packages only through their @graphgoblin/* entry points.',
            },
          ],
        },
      ],
    },
  },
  {
    // Playwright specs and the E2E server run in Node and may use the API test harness.
    files: ['apps/web/e2e/**'],
    rules: { 'no-restricted-imports': 'off', 'no-console': 'off' },
  },
  {
    files: ['apps/web/scripts/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly', console: 'readonly', process: 'readonly' } },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/test/**', '**/__fixtures__/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
