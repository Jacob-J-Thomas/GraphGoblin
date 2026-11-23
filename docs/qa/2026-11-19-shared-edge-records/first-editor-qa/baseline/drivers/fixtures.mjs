export function fixture(name, mode = 'duplicate') {
  const edges = [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick', port: 'in' }, ui: { route: [220] } },
    { id: mode === 'unique' ? 'yes-edge' : 'e1', from: { node: 'pick', port: 'yes' }, to: { node: 'done', port: 'in' }, ui: { route: [530, 200, 640] } },
    { id: mode === 'two-rows' ? 'e1' : 'no-edge', from: { node: 'pick', port: 'no' }, to: { node: 'done', port: 'in' }, ui: { route: [550, 350, 660] } },
    { id: 'c1', from: { node: 'extra', port: 'out' }, to: { node: 'done', port: 'in' }, ui: { route: [240, 450, 690] } },
    { id: 'later-edge', from: { node: 'pick', port: 'later' }, to: { node: 'done', port: 'in' }, ui: { route: [570, 410, 680] } },
  ];
  return {
    schemaVersion: 4, name, description: 'Independent QA baseline',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
      { id: 'pick', kind: 'decision', label: 'Pick', config: { kind: 'expression', jsonata: '"yes"', routes: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }, { id: 'later', label: 'Later' }] }, ui: { x: 310, y: 80 } },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 760, y: 80 } },
      { id: 'extra', kind: 'trigger', label: 'Alternate start', config: { type: 'manual' }, ui: { x: 0, y: 420 } },
    ], edges,
  };
}
