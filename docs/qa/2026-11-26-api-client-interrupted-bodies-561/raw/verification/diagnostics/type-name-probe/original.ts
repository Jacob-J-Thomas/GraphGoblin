const NATIVE: ReadonlySet<ResponseType> = new Set<ResponseType>(['basic', 'cors']);
let chunk: ReadableStreamReadResult<Uint8Array> | undefined;
export const used = [NATIVE, chunk];
