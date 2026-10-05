import type { DragEvent } from 'react';
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { SidePanel } from '../components/ui/index.js';
import { KindChip, kindStyle } from './KindChip.js';
import { KIND_INFO, KIND_MIME, NODE_KINDS } from './model.js';
import { useEditorStore } from './store.js';

/** The palette panel's element id and per-browser storage key. */
export const PALETTE_PANEL_ID = 'palette';
export const PALETTE_STORAGE_KEY = 'graphgoblin-palette';

/** Until the user chooses, the palette starts expanded at this width and wider (px). */
export const PALETTE_PANEL_WIDE = 1024;

/** The default when nothing is stored: expanded on wide windows, collapsed below. */
export function palettePanelDefault(): boolean {
  return window.innerWidth >= PALETTE_PANEL_WIDE;
}

function PaletteButton({
  kind,
  compact,
  onAdd,
}: {
  kind: (typeof NODE_KINDS)[number];
  compact: boolean;
  onAdd: (kind: (typeof NODE_KINDS)[number]) => void;
}) {
  return (
    <button
      type="button"
      draggable
      aria-label={`Add ${KIND_INFO[kind].label} node`}
      title={`${KIND_INFO[kind].label}: ${KIND_INFO[kind].description}`}
      style={kindStyle(kind)}
      className={
        compact
          ? 'grid size-10 shrink-0 cursor-grab place-items-center rounded-md border border-default bg-surface-raised shadow-1 transition-[background-color,border-color,box-shadow,translate] hover:-translate-y-px hover:border-kind hover:bg-kind-subtle hover:shadow-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus pointer-coarse:size-11'
          : 'grid w-full cursor-grab grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-md border border-default bg-surface-raised py-[7px] pr-2.5 pl-[7px] text-left text-default shadow-1 transition-[translate,box-shadow,background-color,border-color] hover:-translate-y-px hover:border-kind hover:bg-kind-subtle hover:shadow-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
      }
      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.setData(KIND_MIME, kind);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onAdd(kind)}
    >
      <KindChip kind={kind} {...(!compact ? { className: 'row-span-2' } : {})} />
      {compact ? null : (
        <>
          <span className="text-sm leading-tight font-semibold">{KIND_INFO[kind].label}</span>
          <span className="text-xs leading-[1.3] text-muted">{KIND_INFO[kind].description}</span>
        </>
      )}
    </button>
  );
}

/**
 * The nine node kinds. Drag one onto the canvas, or press it (keyboard friendly) to add it below
 * the existing nodes; the canvas then pans to the new node so it is never added out of sight.
 */
export function Palette({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const flow = useReactFlow();
  const add = useCallback(
    (kind: (typeof NODE_KINDS)[number]) => {
      const def = useEditorStore.getState().definition;
      const lowest = Math.max(0, ...(def?.nodes ?? []).map((n) => n.ui?.y ?? 0));
      const position = { x: 40, y: lowest + 140 };
      useEditorStore.getState().addNode(kind, position);
      void flow.setCenter(position.x + 90, position.y + 40, {
        zoom: flow.getZoom(),
        duration: 200,
      });
    },
    [flow],
  );

  return (
    <SidePanel
      id={PALETTE_PANEL_ID}
      title="Palette"
      side="left"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      expandedWidth={200}
      rail={
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex flex-col items-center gap-1.5 py-1">
            {NODE_KINDS.map((kind) => (
              <PaletteButton key={kind} kind={kind} compact onAdd={add} />
            ))}
          </div>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
        <nav aria-label="Node palette" className="flex flex-col gap-1.5">
          {NODE_KINDS.map((kind) => (
            <PaletteButton key={kind} kind={kind} compact={false} onAdd={add} />
          ))}
        </nav>
      </div>
    </SidePanel>
  );
}
