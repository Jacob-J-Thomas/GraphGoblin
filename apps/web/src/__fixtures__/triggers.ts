import type { z } from 'zod';
import type { TriggerConfigSchema } from '@graphgoblin/contracts';

type TriggerInput = z.input<typeof TriggerConfigSchema>;
type TriggerType = TriggerInput['type'];
type Fields<T> = T extends unknown ? Omit<T, 'type'> : never;
export type TriggerFields<T extends TriggerType> = Fields<Extract<TriggerInput, { type: T }>>;

/** Shared current trigger configs for unit and e2e fixtures. */
export function triggerConfig<T extends TriggerType>(type: T, fields: TriggerFields<T>) {
  return { type, ...fields };
}

export const manualTriggerConfig = () => triggerConfig('manual', {});
