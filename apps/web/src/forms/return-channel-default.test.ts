import { expect, it } from 'vitest';
import { ReturnChannelSchema } from '@graphgoblin/contracts';
import { initialValue } from './introspect.js';

it('keeps a newly added return destination set to caller', () => {
  expect(initialValue(ReturnChannelSchema)).toEqual({ kind: 'caller' });
});
