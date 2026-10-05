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
