import original from '../../../../packages/infrastructure/vitest.config.ts';
import { retarget } from './retarget.mjs';
export default { ...original, plugins: [...(original.plugins ?? []), retarget] };
