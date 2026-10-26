import base from '../../../packages/infrastructure/vitest.config.ts';
import { locationPlugin } from './fixture-locations.mjs';
export default { ...base, plugins: [...(base.plugins ?? []), locationPlugin()] };
