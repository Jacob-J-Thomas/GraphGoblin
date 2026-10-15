import {
  LIMIT_REACHED_PORT_ID,
  type Edge,
  type LoopDefinition,
  type Node,
  type NodeKind,
} from '@graphgoblin/contracts';
import { syntaxIssues } from './syntax.js';
import { decisionRouteDeclarations } from './answers.js';

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  /** Node or edge id the issue is about, when applicable. */
  nodeId?: string;
  edgeId?: string;
  /**
   * The field the issue is about, when one is: relative to the node (`config.prompt.template`)
   * when `nodeId` is set, else to the definition (`settings.workingDirectory.template`).
   */
  path?: string;
}

/** Output ports a node exposes, derived from its kind and config. */
export function outputPorts(node: Node): string[] {
  switch (node.kind) {
    case 'trigger':
    case 'inference':
    case 'mutate':
    case 'subloop':
    case 'wait':
    case 'heartbeat':
      return ['out'];
    case 'decision':
      return [
        ...decisionRouteDeclarations(node.config).map((route) => route.id),
        ...(decisionRouteDeclarations(node.config).some((route) => route.repeat)
          ? [LIMIT_REACHED_PORT_ID]
          : []),
      ];
    case 'script': {
      const extra = Object.values(node.config.exitCodeRoutes ?? {}).filter(
        (label) => label !== 'out',
      );
      return ['out', ...new Set(extra)];
    }
    case 'exit':
      return [];
  }
}

export function nodeById(def: LoopDefinition, id: string): Node | undefined {
  return def.nodes.find((n) => n.id === id);
}

export function nodesOfKind<K extends NodeKind>(
  def: LoopDefinition,
  kind: K,
): Extract<Node, { kind: K }>[] {
  return def.nodes.filter((n): n is Extract<Node, { kind: K }> => n.kind === kind);
}

/** The single edge leaving a node through a port, if any. */
export function outgoingEdge(def: LoopDefinition, nodeId: string, port: string): Edge | undefined {
  return def.edges.find((e) => e.from.node === nodeId && e.from.port === port);
}

export function outgoingEdges(def: LoopDefinition, nodeId: string): Edge[] {
  return def.edges.filter((e) => e.from.node === nodeId);
}

/** Nodes reachable from a start node by following edges forward. Includes the start node. */
export function reachableFrom(def: LoopDefinition, startId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of outgoingEdges(def, id)) stack.push(edge.to.node);
  }
  return seen;
}

/**
 * Structural validation beyond what the schemas check. Returns an empty array when the loop is
 * publishable. Error-severity issues block publishing; warnings do not.
 */
export function validateLoop(def: LoopDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Map<string, Node>();

  for (const node of def.nodes) {
    if (ids.has(node.id)) {
      issues.push({
        code: 'DUPLICATE_NODE_ID',
        severity: 'error',
        message: `duplicate node id "${node.id}"`,
        nodeId: node.id,
      });
    }
    ids.set(node.id, node);
  }

  const edgeIds = new Set<string>();
  for (const edge of def.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({
        code: 'DUPLICATE_EDGE_ID',
        severity: 'error',
        message: `duplicate edge id "${edge.id}"`,
        edgeId: edge.id,
      });
    }
    edgeIds.add(edge.id);
  }

  const triggers = nodesOfKind(def, 'trigger');
  const exits = nodesOfKind(def, 'exit');
  if (triggers.length === 0) {
    issues.push({
      code: 'NO_TRIGGER',
      severity: 'error',
      message: 'a loop needs at least one trigger node',
    });
  }
  if (exits.length === 0) {
    issues.push({
      code: 'NO_EXIT',
      severity: 'error',
      message: 'a loop needs at least one exit node',
    });
  }

  // Edge endpoints and ports.
  const seenPorts = new Set<string>();
  for (const edge of def.edges) {
    const from = ids.get(edge.from.node);
    const to = ids.get(edge.to.node);
    if (!from) {
      issues.push({
        code: 'EDGE_FROM_MISSING',
        severity: 'error',
        message: `edge "${edge.id}" starts at unknown node "${edge.from.node}"`,
        edgeId: edge.id,
      });
    } else if (!outputPorts(from).includes(edge.from.port)) {
      issues.push({
        code: 'EDGE_PORT_MISSING',
        severity: 'error',
        message: `edge "${edge.id}" leaves node "${from.id}" through unknown port "${edge.from.port}"`,
        edgeId: edge.id,
      });
    } else {
      const key = `${edge.from.node}:${edge.from.port}`;
      if (seenPorts.has(key)) {
        issues.push({
          code: 'PORT_MULTIPLY_CONNECTED',
          severity: 'error',
          message: `port "${edge.from.port}" of node "${from.id}" has more than one outgoing edge`,
          edgeId: edge.id,
        });
      }
      seenPorts.add(key);
    }
    if (!to) {
      issues.push({
        code: 'EDGE_TO_MISSING',
        severity: 'error',
        message: `edge "${edge.id}" ends at unknown node "${edge.to.node}"`,
        edgeId: edge.id,
      });
    } else if (to.kind === 'trigger') {
      issues.push({
        code: 'EDGE_INTO_TRIGGER',
        severity: 'error',
        message: `edge "${edge.id}" targets trigger node "${to.id}"; triggers have no input`,
        edgeId: edge.id,
      });
    }
  }

  // Every output port connected.
  for (const node of def.nodes) {
    for (const port of outputPorts(node)) {
      if (!seenPorts.has(`${node.id}:${port}`)) {
        issues.push({
          code: 'PORT_UNCONNECTED',
          severity: 'error',
          message: `port "${port}" of node "${node.id}" is not connected`,
          nodeId: node.id,
          ...(node.kind === 'decision' && port === LIMIT_REACHED_PORT_ID
            ? { path: 'config.maxPasses' }
            : {}),
        });
      }
    }
  }

  // A marked repeat is a real cycle, never a route straight into an exit or a dead end.
  for (const decision of nodesOfKind(def, 'decision')) {
    const routes = decisionRouteDeclarations(decision.config);
    const repeat = routes.find((route) => route.repeat);
    if (!repeat) continue;
    const edge = outgoingEdge(def, decision.id, repeat.id);
    if (
      edge &&
      (ids.get(edge.to.node)?.kind === 'trigger' ||
        ids.get(edge.to.node)?.kind === 'exit' ||
        !reachableFrom(def, edge.to.node).has(decision.id))
    ) {
      const routePath =
        decision.config.kind !== 'classifier'
          ? `routes.${routes.indexOf(repeat)}`
          : decision.config.answer.type === 'choice'
            ? `answer.options.${routes.indexOf(repeat)}`
            : decision.config.answer.type === 'score'
              ? `answer.bands.${routes.indexOf(repeat)}`
              : `answer.${routes.indexOf(repeat) === 0 ? 'true' : 'false'}`;
      issues.push({
        code: 'REPEAT_ROUTE_NOT_CYCLIC',
        severity: 'error',
        nodeId: decision.id,
        edgeId: edge.id,
        path: `config.${routePath}.repeat`,
        message: 'a repeat route must lead back to its decision gate',
      });
    }
  }

  // Decision context variables must be declared.
  for (const decision of nodesOfKind(def, 'decision')) {
    for (const v of decision.config.kind === 'expression'
      ? []
      : (decision.config.context.vars ?? [])) {
      if (!(v in def.variables)) {
        issues.push({
          code: 'UNDECLARED_VARIABLE',
          severity: 'error',
          message: `decision "${decision.id}" references undeclared variable "${v}"`,
          nodeId: decision.id,
        });
      }
    }
  }

  // Reachability: every trigger reaches an exit; every node is reachable from a trigger.
  const reachableFromAnyTrigger = new Set<string>();
  const exitIds = new Set(exits.map((e) => e.id));
  for (const trigger of triggers) {
    const reach = reachableFrom(def, trigger.id);
    reach.forEach((id) => reachableFromAnyTrigger.add(id));
    if (![...reach].some((id) => exitIds.has(id))) {
      issues.push({
        code: 'TRIGGER_NO_EXIT_PATH',
        severity: 'error',
        message: `trigger "${trigger.id}" cannot reach any exit node`,
        nodeId: trigger.id,
      });
    }
  }
  if (triggers.length > 0) {
    for (const node of def.nodes) {
      if (!reachableFromAnyTrigger.has(node.id)) {
        issues.push({
          code: 'NODE_UNREACHABLE',
          severity: 'error',
          message: `node "${node.id}" is not reachable from any trigger`,
          nodeId: node.id,
        });
      }
    }
  }

  issues.push(...syntaxIssues(def));
  return issues;
}

export function isPublishable(def: LoopDefinition): boolean {
  return validateLoop(def).every((issue) => issue.severity !== 'error');
}
