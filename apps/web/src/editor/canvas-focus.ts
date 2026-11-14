/**
 * Where focus goes when the node editor closes: the node's card on the canvas, or the canvas itself
 * when the node is gone (deleted).
 */
export function canvasFocusTarget(nodeId: string | undefined): HTMLElement | null {
  const card = nodeId
    ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
    : null;
  return card ?? document.querySelector<HTMLElement>('[data-editor-canvas]');
}

/**
 * Where focus goes after a connection's Remove connection button removed it (#207): the toolbar's
 * Undo, which names the removal and restores it. Outside the canvas, a further Delete there cannot
 * remove a node that is still selected. Without the toolbar (a bare canvas), the canvas itself.
 */
export function removalFocusTarget(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-history="undo"]') ??
    document.querySelector<HTMLElement>('[data-editor-canvas]')
  );
}
