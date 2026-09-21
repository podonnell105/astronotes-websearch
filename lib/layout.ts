import { Graph, layout } from "@dagrejs/dagre";
import { Position, type Edge, type Node } from "@xyflow/react";

const NODE_WIDTH = 196;
const NODE_HEIGHT = 56;
const SOURCE_LANE = 16;
const TARGET_LANE = 16;
const PAIR_LANE = 22;
const RANK_BUCKET = 80;

export type EdgeLane = {
  sourceShift: number;
  targetShift: number;
  stepPosition: number;
};

export function layoutGraph(nodes: Node[], edges: Edge[], direction: "LR" | "TB" = "TB") {
  if (nodes.length === 0) return nodes;

  const graph = new Graph({ directed: true, multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 72,
    ranksep: 132,
    edgesep: 28,
    marginx: 32,
    marginy: 32,
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target, {}, edge.id);
  }

  layout(graph);

  return nodes.map((node) => {
    const placed = graph.node(node.id);
    if (!placed) return node;
    return {
      ...node,
      position: {
        x: placed.x - NODE_WIDTH / 2,
        y: placed.y - NODE_HEIGHT / 2,
      },
      sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
      targetPosition: direction === "LR" ? Position.Left : Position.Top,
    } as Node;
  });
}

export function edgeLanes(nodes: Node[], edges: Edge[]): Map<string, EdgeLane> {
  const lanes = new Map<string, EdgeLane>();
  const xOf = new Map(nodes.map((node) => [node.id, node.position.x]));
  const yOf = new Map(
    nodes.map((node) => [node.id, node.position.y + NODE_HEIGHT / 2]),
  );

  const bySource = groupBy(edges, (edge) => edge.source);
  const byTarget = groupBy(edges, (edge) => edge.target);
  const byPair = groupBy(edges, (edge) => `${edge.source}::${edge.target}`);
  const byCorridor = groupBy(edges, (edge) => {
    const sy = yOf.get(edge.source) ?? 0;
    const ty = yOf.get(edge.target) ?? 0;
    return `${Math.round(sy / RANK_BUCKET)}>${Math.round(ty / RANK_BUCKET)}`;
  });

  const sourceShift = new Map<string, number>();
  const targetShift = new Map<string, number>();
  const pairShift = new Map<string, number>();
  const stepPosition = new Map<string, number>();

  for (const group of bySource.values()) {
    const ordered = [...group].sort((a, b) => {
      const ax = xOf.get(a.target) ?? 0;
      const bx = xOf.get(b.target) ?? 0;
      if (ax !== bx) return ax - bx;
      return a.id.localeCompare(b.id);
    });
    ordered.forEach((edge, index) => {
      sourceShift.set(edge.id, spread(index, ordered.length, SOURCE_LANE));
    });
  }

  for (const group of byTarget.values()) {
    const ordered = [...group].sort((a, b) => {
      const ax = xOf.get(a.source) ?? 0;
      const bx = xOf.get(b.source) ?? 0;
      if (ax !== bx) return ax - bx;
      return a.id.localeCompare(b.id);
    });
    ordered.forEach((edge, index) => {
      targetShift.set(edge.id, spread(index, ordered.length, TARGET_LANE));
    });
  }

  for (const group of byPair.values()) {
    const ordered = [...group].sort((a, b) => a.id.localeCompare(b.id));
    ordered.forEach((edge, index) => {
      pairShift.set(edge.id, spread(index, ordered.length, PAIR_LANE));
    });
  }

  for (const group of byCorridor.values()) {
    const ordered = [...group].sort((a, b) => {
      const ax = (xOf.get(a.source) ?? 0) + (xOf.get(a.target) ?? 0);
      const bx = (xOf.get(b.source) ?? 0) + (xOf.get(b.target) ?? 0);
      if (ax !== bx) return ax - bx;
      return a.id.localeCompare(b.id);
    });
    ordered.forEach((edge, index) => {
      stepPosition.set(edge.id, stepped(index, ordered.length));
    });
  }

  for (const edge of edges) {
    const pair = pairShift.get(edge.id) ?? 0;
    lanes.set(edge.id, {
      sourceShift: (sourceShift.get(edge.id) ?? 0) + pair,
      targetShift: (targetShift.get(edge.id) ?? 0) + pair,
      stepPosition: stepPosition.get(edge.id) ?? 0.5,
    });
  }
  return lanes;
}

function stepped(index: number, count: number): number {
  if (count <= 1) return 0.5;
  return 0.2 + (index / (count - 1)) * 0.6;
}

function spread(index: number, count: number, lane: number): number {
  if (count <= 1) return 0;
  return (index - (count - 1) / 2) * lane;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const list = groups.get(id);
    if (list) list.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}
