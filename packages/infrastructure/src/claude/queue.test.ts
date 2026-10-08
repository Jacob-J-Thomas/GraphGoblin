import { expect, it } from 'vitest';
import { EventQueue } from './queue.js';
it('buffers values, wakes a pending consumer and closes idempotently', async () => {
  const queue = new EventQueue<string>();
  queue.push('first');
  const iterator = queue[Symbol.asyncIterator]();
  expect(await iterator.next()).toEqual({ value: 'first', done: false });
  const waiting = iterator.next();
  queue.push('second');
  expect(await waiting).toEqual({ value: 'second', done: false });
  const end = iterator.next();
  queue.close();
  queue.close();
  queue.push('ignored');
  expect(await end).toEqual({ value: undefined, done: true });
  expect(await iterator.next()).toEqual({ value: undefined, done: true });
});
