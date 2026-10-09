import { z } from 'zod';
import { JsonValueSchema, type JsonValue } from '@graphgoblin/contracts';
import type { TemplateTransaction } from '@graphgoblin/infrastructure/sqlite';
import type { TemplateBinding } from '../binding.js';
import { nextAttempt } from '../authority.js';

/** Read-only projection before PollTriggers dedupe; transaction admission recomputes authority. */
export async function implementationPollKeys(
  store: TemplateTransaction,
  binding: TemplateBinding,
  input: JsonValue,
): Promise<JsonValue> {
  if (binding.manifest.id !== 'implementation' || binding.manifest.kind !== 'implementation')
    return input;
  const candidates = z
    .strictObject({
      items: z
        .array(
          z
            .strictObject({
              id: z.number().int().positive(),
              payload: z.strictObject({ issue: z.number().int().positive() }),
            })
            .refine((item) => item.id === item.payload.issue),
        )
        .max(100),
    })
    .parse(input);
  if (!('repository' in binding.settings)) throw new Error('Implementation settings required.');
  const repository = (
    binding.settings.repository.owner +
    '/' +
    binding.settings.repository.name
  ).toLowerCase();
  const items = [];
  for (const item of candidates.items) {
    const attempt = await nextAttempt(store, binding, { repository, issue: item.payload.issue });
    items.push({
      id: repository + '#' + item.payload.issue + '@' + attempt,
      payload: item.payload,
    });
  }
  return JsonValueSchema.parse({ items });
}
