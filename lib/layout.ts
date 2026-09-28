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
    nodesep: 44,
    ranksep: 96,
    edgesep: 18,
    ranker: "tight-tree",
    marginx: 28,
    marginy: 28,
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target, {}, edge.id);
  }

  layout(graph);

  const placed = nodes.map((node) => {
    const spot = graph.node(node.id);
    if (!spot) return node;
    return {
      ...node,
      position: {
        x: spot.x - NODE_WIDTH / 2,
        y: spot.y - NODE_HEIGHT / 2,
      },
      sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
      targetPosition: direction === "LR" ? Position.Left : Position.Top,
    } as Node;
  });
  return packComponents(placed, edges);
}

const COMPONENT_GAP = 72;

function packComponents(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length <= 1) return nodes;
  const groups = componentsOf(nodes, edges).sort((a, b) => b.length - a.length);
  if (groups.length <= 1) return nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const rowWidth = Math.max(960, Math.ceil(Math.sqrt(groups.length)) * 520);

  for (const ids of groups) {
    const members = ids.map((id) => byId.get(id)).filter((node): node is Node => Boolean(node));
    if (members.length === 0) continue;
    const minX = Math.min(...members.map((node) => node.position.x));
    const minY = Math.min(...members.map((node) => node.position.y));
    const maxX = Math.max(...members.map((node) => node.position.x + NODE_WIDTH));
    const maxY = Math.max(...members.map((node) => node.position.y + NODE_HEIGHT));
    const width = maxX - minX;
    const height = maxY - minY;
    if (cursorX > 0 && cursorX + width > rowWidth) {
      cursorX = 0;
      cursorY += rowHeight + COMPONENT_GAP;
      rowHeight = 0;
    }
    const dx = cursorX - minX;
    const dy = cursorY - minY;
    for (const node of members) {
      node.position = { x: node.position.x + dx, y: node.position.y + dy };
    }
    cursorX += width + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, height);
  }
  return nodes;
}

function componentsOf(nodes: Node[], edges: Edge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const group: string[] = [];
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      group.push(id);
      for (const next of adjacency.get(id) ?? []) stack.push(next);
    }
    groups.push(group);
  }
  return groups;
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
