"use client";

import { layoutGraph } from "@/lib/layout";
import {
  entityTypeChip,
  type Entity,
  type EntityType,
  type Relationship,
  type Validation,
} from "@/lib/types";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";

type EntityData = {
  name: string;
  entityType: EntityType;
  dimmed: boolean;
  highlighted: boolean;
};

function EntityNode({ data, selected }: NodeProps<Node<EntityData>>) {
  return (
    <div
      className={`entity-node ${selected ? "selected" : ""} ${data.highlighted ? "highlighted" : ""} ${data.dimmed ? "dimmed" : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="type-chip" title={data.entityType}>
        {entityTypeChip(data.entityType)}
      </div>
      <div className="mt-1 line-clamp-2 text-[12px] leading-4 text-ink">{data.name}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function GraphEdge(props: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  const decision = String(props.data?.decision ?? "PENDING");
  const focused = Boolean(props.data?.focused);
  const selected = Boolean(props.selected);
  const mark =
    decision === "CONTRADICTED" ? "×" : decision === "UNCERTAIN" ? "?" : "";

  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={24}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute origin-center"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <div
            className={`flex items-center gap-1 bg-canvas/90 px-1.5 py-0.5 ${
              selected || focused ? "edge-label-lit" : ""
            }`}
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
              {String(props.label ?? "")}
            </span>
            {mark ? (
              <span className="font-mono text-[10px] text-dim">{mark}</span>
            ) : null}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { entity: EntityNode };
const edgeTypes = { audit: GraphEdge };

function edgeStyle(
  validation?: Validation,
  dimmed?: boolean,
  selected?: boolean,
  focused?: boolean,
) {
  const decision = validation?.decision ?? "PENDING";
  const color =
    selected || focused
      ? "var(--accent)"
      : decision === "CONTRADICTED"
        ? "var(--contradicted)"
        : decision === "UNCERTAIN"
          ? "var(--uncertain)"
          : decision === "SUPPORTED"
            ? "var(--supported)"
            : "var(--handle)";
  return {
    stroke: color,
    strokeDasharray:
      decision === "CONTRADICTED"
        ? "2 4"
        : decision === "UNCERTAIN"
          ? "6 4"
          : undefined,
    strokeWidth: selected ? 2.4 : focused ? 2 : 1.35,
    opacity: dimmed ? 0.18 : 0.95,
  };
}

function GraphInner({
  entities,
  relationships,
  validations,
  selectedRelationshipId,
  selectedEntityId,
  focusedEntityIds,
  focusedRelationshipIds,
  expanded,
  onSelectRelationship,
  onSelectEntity,
  onToggleExpand,
  onResetSelection,
}: {
  entities: Entity[];
  relationships: Relationship[];
  validations: Record<string, Validation>;
  selectedRelationshipId: string | null;
  selectedEntityId: string | null;
  focusedEntityIds: string[];
  focusedRelationshipIds: string[];
  expanded: boolean;
  onSelectRelationship: (id: string | null) => void;
  onSelectEntity: (id: string | null) => void;
  onToggleExpand: () => void;
  onResetSelection: () => void;
}) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<EntityData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const neighborhood = useMemo(() => {
    if (!expanded || !selectedEntityId) return null;
    const ids = new Set<string>([selectedEntityId]);
    for (const rel of relationships) {
      if (rel.source === selectedEntityId || rel.target === selectedEntityId) {
        ids.add(rel.source);
        ids.add(rel.target);
      }
    }
    return ids;
  }, [expanded, selectedEntityId, relationships]);

  const highlight = useMemo(() => new Set(focusedEntityIds), [focusedEntityIds]);
  const citedEdges = useMemo(
    () => new Set(focusedRelationshipIds),
    [focusedRelationshipIds],
  );
  const structureKey = `${entities.map((e) => e.id).join(",")}|${relationships.map((r) => r.id).join(",")}`;

  useEffect(() => {
    const rawNodes: Node<EntityData>[] = entities.map((entity) => ({
      id: entity.id,
      type: "entity",
      position: { x: 0, y: 0 },
      data: {
        name: entity.name,
        entityType: entity.type,
        dimmed: false,
        highlighted: false,
      },
    }));
    const rawEdges: Edge[] = relationships.map((rel) => ({
      id: rel.id,
      source: rel.source,
      target: rel.target,
      type: "audit",
      label: rel.type,
    }));
    setNodes(layoutGraph(rawNodes, rawEdges, "TB") as Node<EntityData>[]);
    setEdges(rawEdges);
    const t = window.setTimeout(() => fitView({ padding: 0.24, duration: 320 }), 50);
    return () => window.clearTimeout(t);
  }, [structureKey, entities, relationships, setNodes, setEdges, fitView]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const entity = entities.find((e) => e.id === node.id);
        if (!entity) return node;
        return {
          ...node,
          selected: selectedEntityId === node.id,
          data: {
            name: entity.name,
            entityType: entity.type,
            dimmed: neighborhood ? !neighborhood.has(node.id) : false,
            highlighted: selectedEntityId
              ? false
              : highlight.has(node.id),
          },
        };
      }),
    );
    setEdges((current) =>
      current.map((edge) => {
        const validation = validations[edge.id];
        const inNeighborhood =
          !neighborhood ||
          (neighborhood.has(edge.source) && neighborhood.has(edge.target));
        const selected = selectedRelationshipId === edge.id;
        const focused = citedEdges.has(edge.id) && !selected;
        const dimmed =
          !inNeighborhood ||
          (citedEdges.size > 0 && !citedEdges.has(edge.id) && !selected);
        const style = edgeStyle(validation, dimmed, selected, focused);
        return {
          ...edge,
          data: {
            decision: validation?.decision ?? "PENDING",
            focused,
          },
          style,
          selected,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: String(style.stroke),
          },
        };
      }),
    );
  }, [
    entities,
    validations,
    neighborhood,
    highlight,
    citedEdges,
    selectedEntityId,
    selectedRelationshipId,
    setNodes,
    setEdges,
  ]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<EntityData>>[]) => {
      onNodesChange(changes.filter((change) => change.type !== "select"));
    },
    [onNodesChange],
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes.filter((change) => change.type !== "select"));
    },
    [onEdgesChange],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="label">Knowledge graph</div>
        <div className="flex gap-1">
          <GraphButton onClick={onToggleExpand} active={expanded}>
            Expand
          </GraphButton>
          <GraphButton onClick={() => fitView({ padding: 0.22, duration: 300 })}>
            Fit
          </GraphButton>
          <GraphButton
            onClick={() => {
              onResetSelection();
              fitView({ padding: 0.22, duration: 300 });
            }}
          >
            Reset
          </GraphButton>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onNodeClick={(_, node) => onSelectEntity(node.id)}
          onEdgeClick={(_, edge) => onSelectRelationship(edge.id)}
          onPaneClick={() => {
            onSelectEntity(null);
            onSelectRelationship(null);
          }}
          nodesDraggable
          nodesFocusable={false}
          edgesFocusable={false}
          selectNodesOnDrag={false}
          selectionOnDrag={false}
          multiSelectionKeyCode={null}
          panOnScroll
          zoomOnScroll
          minZoom={0.35}
          maxZoom={1.8}
          className="h-full bg-canvas"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="var(--grid)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export function KnowledgeGraph(props: {
  entities: Entity[];
  relationships: Relationship[];
  validations: Record<string, Validation>;
  selectedRelationshipId: string | null;
  selectedEntityId: string | null;
  focusedEntityIds: string[];
  focusedRelationshipIds: string[];
  expanded: boolean;
  onSelectRelationship: (id: string | null) => void;
  onSelectEntity: (id: string | null) => void;
  onToggleExpand: () => void;
  onResetSelection: () => void;
}) {
  return (
    <div className="h-full min-h-0 w-full">
      <ReactFlowProvider>
        <GraphInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

function GraphButton({
  children,
  onClick,
  active,
}: {
  children: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
        active
          ? "border-accent/40 text-accent"
          : "border-line text-muted hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
