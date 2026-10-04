import { useReactFlow } from '@xyflow/react';
import { KindChip, kindStyle } from './KindChip.js';
import { KIND_INFO, KIND_MIME, NODE_KINDS } from './model.js';
import { useEditorStore } from './store.js';

/**
 * The nine node kinds. Drag one onto the canvas, or press it (keyboard friendly) to add it below
 * the existing nodes; the canvas then pans to the new node so it is never added out of sight.
 */
export function Palette() {
  const flow = useReactFlow();
  const add = (kind: (typeof NODE_KINDS)[number]) => {
    const def = useEditorStore.getState().definition;
    const lowest = Math.max(0, ...(def?.nodes ?? []).map((n) => n.ui?.y ?? 0));
    const position = { x: 40, y: lowest + 140 };
    useEditorStore.getState().addNode(kind, position);
    void flow.setCenter(position.x + 90, position.y + 40, {
      zoom: flow.getZoom(),
      duration: 200,
    });
  };
  return (
    <nav aria-label="Node palette" className="flex flex-col gap-1.5">
      <h2 className="px-1 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        Palette
      </h2>
      {NODE_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          draggable
          aria-label={`Add ${KIND_INFO[kind].label} node`}
          title={KIND_INFO[kind].description}
          style={kindStyle(kind)}
          className="grid w-full cursor-grab grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-md border border-default bg-surface-raised py-[7px] pr-2.5 pl-[7px] text-left text-default shadow-1 transition-[translate,box-shadow,background-color,border-color] hover:-translate-y-px hover:border-kind hover:bg-kind-subtle hover:shadow-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onDragStart={(event) => {
            event.dataTransfer.setData(KIND_MIME, kind);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onClick={() => add(kind)}
        >
          <KindChip kind={kind} className="row-span-2" />
          <span className="text-sm leading-tight font-semibold">{KIND_INFO[kind].label}</span>
          <span className="text-xs leading-[1.3] text-muted">{KIND_INFO[kind].description}</span>
        </button>
      ))}
    </nav>
  );
}
