import { Graph, layout } from "@dagrejs/dagre";
import { Position, type Edge, type Node } from "@xyflow/react";

const NODE_WIDTH = 196;
const NODE_HEIGHT = 56;

export function layoutGraph(nodes: Node[], edges: Edge[], direction: "LR" | "TB" = "TB") {
  if (nodes.length === 0) return nodes;

  const graph = new Graph({ directed: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 72,
    ranksep: 96,
    marginx: 32,
    marginy: 32,
  });

  for (const node of nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
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
