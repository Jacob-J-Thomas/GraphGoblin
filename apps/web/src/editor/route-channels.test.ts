import { expect, it, vi } from 'vitest';
import { routingInput, simpleLoop } from '../__fixtures__/routing.js';
import { createRoutingPlan } from './routing.js';
import { createRouteChannels } from './route-channels.js';

const routesOf = (...args: Parameters<typeof createRoutingPlan>) =>
  createRoutingPlan(...args).routes;

it('publishes changed geometry only to its edge, releases deleted entries and supports unsubscription', () => {
  const { nodes, edges } = routingInput(simpleLoop());
  const routes = routesOf(nodes, edges);
  const channels = createRouteChannels();
  const active = new Set(['return', 'pending']);
  const back = channels.edge('return', routes.get('return'));
  const pending = channels.edge('pending', undefined);
  expect(channels.edge('return', undefined)).toBe(back);
  const changed = vi.fn();
  const untouched = vi.fn();
  const unsubscribe = back.subscribe(changed);
  pending.subscribe(untouched);
  channels.publish(routes, active);
  expect(changed).not.toHaveBeenCalled();
  const next = { ...routes.get('return')!, labelWidth: 20 };
  channels.publish(new Map([['return', next]]), active);
  expect(back.getSnapshot()).toBe(next);
  expect(changed).toHaveBeenCalledOnce();
  expect(untouched).not.toHaveBeenCalled();
  unsubscribe();
  channels.publish(new Map(), new Set());
  expect(changed).toHaveBeenCalledOnce();
  expect(back.getSnapshot()).toBeUndefined();
  expect(channels.edge('return', next)).not.toBe(back);
});
