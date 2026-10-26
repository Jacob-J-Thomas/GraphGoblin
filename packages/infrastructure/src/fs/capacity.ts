import { statfs } from 'node:fs/promises';

/** Public composition dependency; available bytes are those usable by this process. */
export interface StorageCapacityPort {
  read(path: string): Promise<{ totalBytes: number; availableBytes: number }>;
}

export class FsStorageCapacity implements StorageCapacityPort {
  async read(path: string) {
    const stats = await statfs(path, { bigint: true });
    return {
      totalBytes: Number(stats.blocks * stats.bsize),
      availableBytes: Number(stats.bavail * stats.bsize),
    };
  }
}
