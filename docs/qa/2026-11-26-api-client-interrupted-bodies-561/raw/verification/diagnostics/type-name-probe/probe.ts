const NATIVE: ReadonlySet<Response['type']> = new Set<Response['type']>(['basic', 'cors']);
declare const body: ReadableStream<Uint8Array>;
const reader = body.getReader();
let chunk: Awaited<ReturnType<typeof reader.read>>;
export async function probe(): Promise<boolean> {
  chunk = await reader.read();
  if (chunk.done) return NATIVE.has('basic');
  const bytes: Uint8Array = chunk.value;
  return bytes.length > 0;
}
