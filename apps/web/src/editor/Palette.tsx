import { KIND_INFO, KIND_MIME, NODE_KINDS } from './model.js';
import { useEditorStore } from './store.js';

/**
 * The nine node kinds. Drag one onto the canvas, or press it (keyboard friendly) to add it below
 * the existing nodes.
 */
export function Palette() {
  const add = (kind: (typeof NODE_KINDS)[number]) => {
    const def = useEditorStore.getState().definition;
    const lowest = Math.max(0, ...(def?.nodes ?? []).map((n) => n.ui?.y ?? 0));
    useEditorStore.getState().addNode(kind, { x: 40, y: lowest + 140 });
  };
  return (
    <nav aria-label="Node palette" className="flex flex-col gap-1">
      <h2 className="text-xs font-semibold text-slate-600 uppercase">Palette</h2>
      {NODE_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          draggable
          aria-label={`Add ${KIND_INFO[kind].label} node`}
          title={KIND_INFO[kind].description}
          className="cursor-grab rounded border border-slate-300 bg-white px-2 py-1 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-600"
          onDragStart={(event) => {
            event.dataTransfer.setData(KIND_MIME, kind);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onClick={() => add(kind)}
        >
          {KIND_INFO[kind].label}
        </button>
      ))}
    </nav>
  );
}
