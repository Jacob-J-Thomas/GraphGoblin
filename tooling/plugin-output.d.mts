export interface PluginOutputOptions {
  outDir: string;
  packageDir: string;
  defaultOutDir: string;
  protectedPaths: readonly string[];
  kind: string;
  files: Readonly<Record<string, string | Uint8Array>>;
}

/**
 * Publish the builder's finite generated inventory. A failure that leaves staging behind, or any
 * cleanup failure, rejects with an `AggregateError`: `cause` is the primary failure (if any),
 * `errors` lists it before each cleanup failure, and the message states what was published and
 * which staging paths remain.
 */
export function writePluginOutput(options: PluginOutputOptions): Promise<string>;

/**
 * Refuse every entry below `root` other than the listed regular files (`/`-separated names) and
 * the folders containing them. Links and other special entries are refused, never followed.
 */
export function checkSourceInventory(root: string, files: readonly string[]): Promise<void>;
