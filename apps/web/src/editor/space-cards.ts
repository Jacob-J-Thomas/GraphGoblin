import type { LoopDefinitionInput, NodeInput } from '@graphgoblin/contracts';
import { canvasPorts } from './model.js';
import type { Point } from './routing-geometry.js';

type SpaceDefinition = Pick<LoopDefinitionInput, 'nodes' | 'edges'>;

/**
 * Space cards layout in flow pixels: the distance between neighbouring columns (a 184 px card and
 * an 88 px gap) and the clear space kept between cards stacked in one column.
 */
export const SPACE_CARDS = { column: 272, rowGap: 44 } as const;

/**
 * A card's conservative height in flow pixels, without measuring it. A card with no outputs is 92
 * tall (border, 36 px header and text rows). Each output adds a 44 px coarse-pointer row and a 2 px
 * gap, and the first row follows a 4 px margin, so n outputs add 2 + 46n (`NodeCard`,
 * `canvas.css`). The fine pointer's rows are shorter, so this never underestimates them. It does
 * not depend on the viewport or the pointer, so the same graph gets the same spacing everywhere at
 * the default text size. Larger text needs a measured height; see `spacedPositions`.
 */
export const spacedCardHeight = (ports: number): number => 92 + (ports > 0 ? 2 + 46 * ports : 0);

const atOrigin = (node: NodeInput): boolean => !node.ui || (node.ui.x === 0 && node.ui.y === 0);

/**
 * Whether the Space cards action may be offered: at least two cards, every card displayed at the
 * origin (an absent `ui` and an explicit zero, including `-0`, are the same), and no connection
 * with a stored route. Positioned, partly positioned and routed loops are never candidates.
 * Eligibility only means the offer may show; the caller checks it again before applying.
 */
export function spaceCardsEligible(definition: SpaceDefinition): boolean {
  return (
    definition.nodes.length >= 2 &&
    definition.nodes.every(atOrigin) &&
    definition.edges.every((edge) => !edge.ui)
  );
}

/** What placement needs to know about one card. */
interface Card {
  readonly id: string;
  readonly trigger: boolean;
  /** The output ports a connection may leave from. */
  readonly ports: ReadonlySet<string>;
  readonly height: number;
  /** Where this card's counted connections lead, in edge array order. */
  readonly next: Card[];
  /** Counted connections that lead here. */
  incoming: number;
  /** Depth from the entries; -1 until the card is discovered. */
  column: number;
  y: number;
}

function cardOf(node: NodeInput, measured: number | undefined): Card {
  const ports = canvasPorts(node);
  const footprint = spacedCardHeight(ports.length);
  return {
    id: node.id,
    trigger: node.kind === 'trigger',
    ports: new Set(ports),
    // Anything not above the footprint (missing, NaN, zero, negative) keeps the footprint.
    height:
      measured !== undefined && Number.isFinite(measured) && measured > footprint
        ? measured
        : footprint,
    next: [],
    incoming: 0,
    column: -1,
    y: 0,
  };
}

/**
 * Records the connections that count for placement. A connection is ignored, never changed, when
 * its id is not unique, either end is missing or names more than one card, it enters a trigger,
 * it leaves from a port the source does not have, or it is a self-loop.
 */
function connect(cards: readonly Card[], edges: SpaceDefinition['edges']): void {
  const byId = new Map<string, Card>();
  const ambiguous = new Set<string>();
  for (const card of cards) {
    if (byId.has(card.id)) ambiguous.add(card.id);
    else byId.set(card.id, card);
  }
  // Two cards with one id must not be combined into an invented path.
  for (const id of ambiguous) byId.delete(id);

  const edgeCounts = new Map<string, number>();
  for (const edge of edges) edgeCounts.set(edge.id, (edgeCounts.get(edge.id) ?? 0) + 1);
  for (const edge of edges) {
    const from = byId.get(edge.from.node);
    const to = byId.get(edge.to.node);
    if (!from || !to || from === to || to.trigger) continue;
    if (edgeCounts.get(edge.id) !== 1 || !from.ports.has(edge.from.port)) continue;
    from.next.push(to);
    to.incoming += 1;
  }
}

/** Every trigger, else every card nothing leads to, else the first card. */
function entryCards(cards: readonly Card[]): Card[] {
  const triggers = cards.filter((card) => card.trigger);
  if (triggers.length > 0) return triggers;
  const sources = cards.filter((card) => card.incoming === 0);
  return sources.length > 0 ? sources : cards.slice(0, 1);
}

/**
 * Gives every card a column (its breadth-first depth) and returns the cards in the order they were
 * discovered. All entries start together at depth 0, and each card is marked when it is queued, so
 * every card and counted connection is handled once. Cards no entry reaches then start their own
 * search at depth 0, in array order.
 */
function discover(cards: readonly Card[]): Card[] {
  const queue: Card[] = [];
  let head = 0;
  const enqueue = (card: Card, column: number): void => {
    card.column = column;
    queue.push(card);
  };
  const drain = (): void => {
    for (; head < queue.length; head += 1) {
      const card = queue[head]!;
      for (const next of card.next) if (next.column < 0) enqueue(next, card.column + 1);
    }
  };
  for (const entry of entryCards(cards)) enqueue(entry, 0);
  drain();
  for (const card of cards) {
    if (card.column >= 0) continue;
    enqueue(card, 0);
    drain();
  }
  return queue;
}

/** Stacks each column's cards top down in discovery order, with the row gap between them. */
function stack(discovered: readonly Card[]): void {
  const bottoms: number[] = [];
  for (const card of discovered) {
    const top = bottoms[card.column] ?? 0;
    card.y = top;
    bottoms[card.column] = top + card.height + SPACE_CARDS.rowGap;
  }
}

/**
 * Space cards positions, one per card and indexed like `definition.nodes`. A card's column is its
 * depth from the entries along connections the canvas can draw, so connected cards read left to
 * right. Columns are `SPACE_CARDS.column` apart and each column's cards stack with at least
 * `SPACE_CARDS.rowGap` between them. The whole layout then shifts so `nodes[0]` is at the origin,
 * which can leave other coordinates negative. Every card is placed, whatever its id, and the
 * result depends on the graph's shape and array order, not on its ids, so renaming ids
 * consistently changes nothing. The same graph and heights always give the same result.
 *
 * Each card takes the larger of `spacedCardHeight` and its entry in `heights`, a measured height
 * in flow pixels by node index. A missing, non-finite, zero or negative entry is ignored. The
 * helper never reads the DOM or the viewport. It does not promise crossing-free connections or
 * that a long chain fits in one view, and it neither checks eligibility nor changes anything.
 *
 * Work is O(nodes + edges + total ports): each card's ports are listed once, each edge is read
 * twice, and each card and counted connection is visited once.
 */
export function spacedPositions(
  definition: SpaceDefinition,
  heights: readonly (number | undefined)[] = [],
): Point[] {
  const cards = definition.nodes.map((node, index) => cardOf(node, heights[index]));
  connect(cards, definition.edges);
  stack(discover(cards));
  const anchor = cards[0];
  if (!anchor) return [];
  const anchorX = anchor.column * SPACE_CARDS.column;
  return cards.map((card) => ({
    x: card.column * SPACE_CARDS.column - anchorX,
    y: card.y - anchor.y,
  }));
}

/**
 * A copy of the definition with `ui` set from `positions`, which must hold exactly one position per
 * node and be indexed like the nodes, as `spacedPositions` returns them. It is the last step of the
 * all-card Space cards action, not a way to move some cards, so a different count throws before
 * anything is built and no loop is ever spaced in part. The first node is the anchor and is never
 * written (its object, and an absent `ui`, stay as they are). Everything else, edges included,
 * keeps its identity, and the input is not modified.
 */
export function withSpacedPositions(
  definition: LoopDefinitionInput,
  positions: readonly Point[],
): LoopDefinitionInput {
  if (positions.length !== definition.nodes.length) {
    throw new Error(
      `Space cards needs one position for each of the ${definition.nodes.length} cards, but got ${positions.length}.`,
    );
  }
  return {
    ...definition,
    nodes: definition.nodes.map((node, index) => {
      const position = positions[index]!;
      return index === 0 ? node : { ...node, ui: { x: position.x, y: position.y } };
    }),
  };
}
