import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
export const probe = async () => ({ statIsSeam: stat.name, spawnIsSeam: spawn.name, now: performance.now() });
