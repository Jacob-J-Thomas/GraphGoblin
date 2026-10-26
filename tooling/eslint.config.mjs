import base from '../eslint.config.js';

export default [
  ...base,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        global: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        performance: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        window: 'readonly',
        document: 'readonly',
        sessionStorage: 'readonly',
        PerformanceObserver: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
    // Gate scripts intentionally print diagnostics and result records.
    rules: { 'no-console': 'off' },
  },
];
