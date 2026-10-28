import { expect, it, vi } from 'vitest';
import { routingInput, simpleLoop } from '../__fixtures__/routing.js';
import { createRoutingPlan } from './routing.js';
import { createRouteChannels } from './route-channels.js';
import { labelBox } from './edge-label-placement.js';

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

it('publishes label movement and removal without waking unchanged edge geometry', () => {
  const channels = createRouteChannels();
  const at = { x: 40, y: 60 };
  const label = { at, box: labelBox('one', 'Finish', at) };
  const channel = channels.edge('one', undefined, label);
  const changed = vi.fn();
  channel.subscribe(changed);
  const active = new Set(['one']);
  channels.publish(new Map(), active, new Map([['one', structuredClone(label)]]));
  expect(changed).not.toHaveBeenCalled();
  const next = { ...label, anchor: { x: 0, y: 0 } };
  channels.publish(new Map(), active, new Map([['one', next]]));
  expect(channel.getLabelSnapshot()).toBe(next);
  expect(channel.getSnapshot()).toBeUndefined();
  expect(changed).toHaveBeenCalledOnce();
  channels.publish(new Map(), active);
  expect(channel.getLabelSnapshot()).toBeUndefined();
  expect(changed).toHaveBeenCalledTimes(2);
});

it('publishes a changed edge attachment even when the settled pill stays in place', () => {
  const channels = createRouteChannels();
  const at = { x: 40, y: 60 };
  const label = {
    at,
    box: labelBox('one', 'Finish', at),
    attachment: { segment: 0, fraction: 0.5, offset: { x: 0, y: 0 } },
  };
  const channel = channels.edge('one', undefined, label);
  const changed = vi.fn();
  channel.subscribe(changed);
  const publish = (next: typeof label) =>
    channels.publish(new Map(), new Set(['one']), new Map([['one', next]]));
  publish(structuredClone(label));
  expect(changed).not.toHaveBeenCalled();
  const next = { ...label, attachment: { ...label.attachment, fraction: 0.25 } };
  publish(next);
  expect(channel.getLabelSnapshot()).toBe(next);
  expect(changed).toHaveBeenCalledOnce();
});
