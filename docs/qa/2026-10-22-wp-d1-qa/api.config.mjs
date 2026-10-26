import base from '../../../apps/api/vitest.config.ts';
import { locationPlugin } from './fixture-locations.mjs';
export default { ...base, plugins: [...(base.plugins ?? []), locationPlugin()] };
