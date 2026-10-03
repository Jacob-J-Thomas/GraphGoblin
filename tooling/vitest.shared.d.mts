import type { UserConfig } from 'vitest/config';

/**
 * Shared Vitest configuration with the repository coverage thresholds applied.
 * See docs/10-testing-and-quality.md.
 */
export declare function createVitestConfig(overrides?: UserConfig): UserConfig;
