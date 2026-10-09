import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { SUPPORT_VERSION, SupportEnvelopeSchema, blocked } from './protocol.js';
import { nativeSupport, type ImplementationSupport } from './implementation.js';

export async function supportEntry(
  args: readonly string[],
  input: string,
  factory: (
    settings: ReturnType<typeof SupportEnvelopeSchema.parse>['settings'],
  ) => Promise<Pick<ImplementationSupport, 'execute'>> = nativeSupport,
): Promise<unknown> {
  if (args.length === 1 && args[0] === '--version')
    return { name: 'graphgoblin-implementation-support', version: SUPPORT_VERSION };
  if (args.length !== 1 || Buffer.byteLength(input) > 1048576)
    return blocked('SUPPORT_INVALID_INPUT');
  try {
    const envelope = SupportEnvelopeSchema.parse(JSON.parse(input));
    return await (await factory(envelope.settings)).execute(args[0], envelope);
  } catch {
    return blocked('SUPPORT_UNAVAILABLE');
  }
}
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = process.argv[2] === '--version' ? '' : await readSupportInput(process.stdin);
    const output = await supportEntry(process.argv.slice(2), input);
    process.stdout.write(JSON.stringify(output) + '\n');
  } catch {
    process.stdout.write(JSON.stringify(blocked('SUPPORT_UNAVAILABLE')) + '\n');
  }
}
