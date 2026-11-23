import { stat } from 'node:fs/promises';
export const probe = async () => ({ statResult: await stat('.').then((v) => (v === 'seam' ? 'seam' : 'native'), () => 'native-error'), now: performance.now() });
