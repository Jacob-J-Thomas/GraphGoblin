import type { z } from 'zod';
import type { TriggerConfigSchema } from '@graphgoblin/contracts';

type TriggerInput = z.input<typeof TriggerConfigSchema>;
type TriggerType = TriggerInput['subtype'];
type Fields<T> = T extends unknown ? Omit<T, 'subtype'> : never;
export type TriggerFields<T extends TriggerType> = Fields<Extract<TriggerInput, { subtype: T }>>;

/** The current stored discriminator lives here so T3 can switch shared fixtures in one place. */
export function triggerConfig<T extends TriggerType>(type: T, fields: TriggerFields<T>) {
  return { subtype: type, ...fields };
}

export const manualTriggerConfig = () => triggerConfig('manual', {});
