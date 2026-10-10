import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { REVIEW_SUPPORT_VERSION, ReviewEnvelopeSchema, reviewBlocked } from './review-protocol.js';
import { nativeReviewSupport, type ReviewSupport } from './review.js';
import { readSupportInput } from './support-input.js';
export async function reviewEntry(
  args: readonly string[],
  input: string,
  factory: (
    settings: ReturnType<typeof ReviewEnvelopeSchema.parse>['settings'],
  ) => Promise<Pick<ReviewSupport, 'execute'>> = nativeReviewSupport,
): Promise<unknown> {
  if (args.length === 1 && args[0] === '--version')
    return { name: 'graphgoblin-review-support', version: REVIEW_SUPPORT_VERSION };
  if (args.length !== 1 || Buffer.byteLength(input) > 1048576)
    return reviewBlocked('SUPPORT_INVALID_INPUT');
  try {
    const envelope = ReviewEnvelopeSchema.parse(JSON.parse(input));
    return await (await factory(envelope.settings)).execute(args[0]!, envelope);
  } catch {
    return reviewBlocked('SUPPORT_UNAVAILABLE');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = process.argv[2] === '--version' ? '' : await readSupportInput(process.stdin);
    process.stdout.write(JSON.stringify(await reviewEntry(process.argv.slice(2), input)) + '\n');
  } catch {
    process.stdout.write(JSON.stringify(reviewBlocked('SUPPORT_UNAVAILABLE')) + '\n');
  }
}
