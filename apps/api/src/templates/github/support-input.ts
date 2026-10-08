export async function readSupportInput(stream: AsyncIterable<Buffer | string>): Promise<string> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of stream) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 1048576) throw new Error('Support input bound');
    parts.push(part);
  }
  return Buffer.concat(parts).toString('utf8');
}
