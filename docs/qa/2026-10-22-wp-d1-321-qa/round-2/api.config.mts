import original from '../../../../apps/api/vitest.config.ts';
import { retarget } from './retarget.mjs';
export default { ...original, plugins: [...(original.plugins ?? []), retarget] };
