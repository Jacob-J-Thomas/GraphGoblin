import { describe, expect, it } from 'vitest';
import { edgeLabelText } from './edge-label-text.js';

describe('edgeLabelText', () => {
  const route = { blocked: false, unavailable: false, labelWidth: 21 };
  it('keeps forward and fitting routed text complete', () => {
    expect(edgeLabelText('Finish')).toEqual({ full: 'Finish', visible: 'Finish' });
    expect(edgeLabelText('Yes', route)).toEqual({ full: 'Yes', visible: 'Yes' });
  });
  it('shortens to the route capacity, including fractional and empty capacities', () => {
    expect(edgeLabelText('Finish', route)).toEqual({ full: 'Finish', visible: 'Fi…' });
    expect(edgeLabelText('Finish', { ...route, labelWidth: 20 })).toEqual({
      full: 'Finish',
      visible: 'F…',
    });
    expect(edgeLabelText('Finish', { ...route, labelWidth: 0 })).toEqual({
      full: 'Finish',
      visible: '…',
    });
  });
  it('keeps full warnings, using Connection when the port has no display text', () => {
    const full = 'Finish: Port covered by a card; move the card';
    expect(edgeLabelText('Finish', { ...route, blocked: true })).toEqual({ full, visible: full });
    const unavailable = 'Connection: No clear route; move a card';
    expect(edgeLabelText('', { ...route, unavailable: true })).toEqual({
      full: unavailable,
      visible: unavailable,
    });
  });
});
