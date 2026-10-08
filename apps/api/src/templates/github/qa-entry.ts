import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { QaPrivateEnvelopeSchema } from './qa-envelope.js';
import { NativeQaDiscovery } from './qa-native.js';
import { qaBlocked } from './qa-protocol.js';
import { readSupportInput } from './support-input.js';
export const QA_SUPPORT_VERSION = '1.0.0';
export async function qaEntry(
  args: readonly string[],
  input: string,
  factory: () => Pick<NativeQaDiscovery, 'execute'> = () => new NativeQaDiscovery(),
): Promise<unknown> {
  if (args.length === 1 && args[0] === '--version')
    return { name: 'graphgoblin-qa-support', version: QA_SUPPORT_VERSION };
  if (args.length !== 1 || Buffer.byteLength(input) > 1048576) return qaBlocked('QA_INVALID_INPUT');
  try {
    return await factory().execute(args[0]!, QaPrivateEnvelopeSchema.parse(JSON.parse(input)));
  } catch {
    return qaBlocked('QA_SUPPORT_UNAVAILABLE');
  }
}
/** Bounded CLI transport is separately testable without spawning a native process. */
export async function qaCli(
  args: readonly string[],
  input: AsyncIterable<Buffer | string>,
  write: (text: string) => void,
): Promise<void> {
  try {
    const text = args[0] === '--version' ? '' : await readSupportInput(input);
    write(JSON.stringify(await qaEntry(args, text)) + '\n');
  } catch {
    write(JSON.stringify(qaBlocked('QA_SUPPORT_UNAVAILABLE')) + '\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await qaCli(process.argv.slice(2), process.stdin, (text) => {
    process.stdout.write(text);
  });
}
