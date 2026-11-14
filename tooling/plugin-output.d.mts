export interface PluginOutputOptions {
  outDir: string;
  packageDir: string;
  defaultOutDir: string;
  protectedPaths: readonly string[];
  kind: string;
  files: Readonly<Record<string, string | Uint8Array>>;
}

export function writePluginOutput(options: PluginOutputOptions): Promise<string>;
