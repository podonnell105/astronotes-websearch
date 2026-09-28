"use client";

import { edgeLanes, layoutGraph } from "@/lib/layout";
import { buildTimeline, formatEpisodeTime } from "@/lib/timeline";
import {
  entityTypeChip,
  type Entity,
  type EntityType,
  type Relationship,
  type RelationshipBasis,
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
  const sourceShift = Number(props.data?.sourceShift ?? 0);
  const targetShift = Number(props.data?.targetShift ?? 0);
  const step = clamp(Number(props.data?.stepPosition ?? 0.5), 0.18, 0.82);
  const sourceX = props.sourceX + sourceShift;
  const targetX = props.targetX + targetShift;
  const sourceGappedY =
    props.sourceY + (props.sourcePosition === Position.Bottom ? 20 : props.sourcePosition === Position.Top ? -20 : 0);
  const targetGappedY =
    props.targetY + (props.targetPosition === Position.Top ? -20 : props.targetPosition === Position.Bottom ? 20 : 0);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY: props.sourceY,
    targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
    offset: 20,
    borderRadius: 5,
    stepPosition: step,
    centerX: sourceX + (targetX - sourceX) * 0.5,
    centerY: sourceGappedY + (targetGappedY - sourceGappedY) * step,
  });
  const decision = String(props.data?.decision ?? "PENDING");
  const basis = String(props.data?.basis ?? "extracted");
  const focused = Boolean(props.data?.focused);
  const selected = Boolean(props.selected);
  const mark =
    basis === "inferred"
      ? "~"
      : decision === "CONTRADICTED"
        ? "×"
        : decision === "UNCERTAIN"
          ? "?"
          : "";

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function edgeStyle(
  validation?: Validation,
  dimmed?: boolean,
  selected?: boolean,
  focused?: boolean,
  basis?: RelationshipBasis,
) {
  const decision = validation?.decision ?? "PENDING";
  const color =
    selected || focused
      ? "var(--accent)"
      : basis === "inferred"
        ? "var(--uncertain)"
        : decision === "CONTRADICTED"
          ? "var(--contradicted)"
          : decision === "UNCERTAIN"
            ? "var(--uncertain)"
            : decision === "SUPPORTED" || basis === "recorded"
              ? "var(--supported)"
              : "var(--handle)";
  return {
    stroke: color,
    strokeDasharray:
      basis === "inferred"
        ? "4 5"
        : decision === "CONTRADICTED"
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
  chromeOpen = true,
  onToggleChrome,
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
  chromeOpen?: boolean;
  onToggleChrome?: () => void;
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
    const seenNodes = new Set<string>();
    const rawNodes: Node<EntityData>[] = [];
    for (const entity of entities) {
      if (!entity.id || seenNodes.has(entity.id)) continue;
      seenNodes.add(entity.id);
      rawNodes.push({
        id: entity.id,
        type: "entity",
        position: { x: 0, y: 0 },
        data: {
          name: entity.name,
          entityType: entity.type,
          dimmed: false,
          highlighted: false,
        },
      });
    }
    const seenEdges = new Set<string>();
    const rawEdges: Edge[] = [];
    for (const rel of relationships) {
      if (!rel.id || seenEdges.has(rel.id)) continue;
      if (!seenNodes.has(rel.source) || !seenNodes.has(rel.target)) continue;
      if (rel.source === rel.target) continue;
      seenEdges.add(rel.id);
      rawEdges.push({
        id: rel.id,
        source: rel.source,
        target: rel.target,
        type: "audit",
        label: rel.time ? `${rel.type} ${formatEpisodeTime(rel.time)}` : rel.type,
        data: { basis: rel.basis ?? "extracted" },
      });
    }
    let placed: Node<EntityData>[] = rawNodes;
    try {
      placed = layoutGraph(rawNodes, rawEdges, "TB") as Node<EntityData>[];
    } catch {
      placed = rawNodes;
    }
    const lanes = edgeLanes(placed, rawEdges);
    setNodes(placed);
    setEdges(
      rawEdges.map((edge) => ({
        ...edge,
        data: lanes.get(edge.id) ?? { sourceShift: 0, targetShift: 0, stepPosition: 0.5 },
      })),
    );
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
        const rel = relationships.find((item) => item.id === edge.id);
        const basis = rel?.basis ?? "extracted";
        const style = edgeStyle(validation, dimmed, selected, focused, basis);
        return {
          ...edge,
          data: {
            decision: validation?.decision ?? "PENDING",
            basis,
            focused,
            sourceShift: Number(edge.data?.sourceShift ?? 0),
            targetShift: Number(edge.data?.targetShift ?? 0),
            stepPosition: Number(edge.data?.stepPosition ?? 0.5),
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
    relationships,
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
      {chromeOpen && (
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
            {onToggleChrome && (
              <GraphButton onClick={onToggleChrome}>Hide</GraphButton>
            )}
          </div>
        </div>
      )}
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
      <TimelineStrip
        relationships={relationships}
        selectedRelationshipId={selectedRelationshipId}
        focusedRelationshipIds={focusedRelationshipIds}
        onSelect={onSelectRelationship}
      />
    </div>
  );
}

function TimelineStrip({
  relationships,
  selectedRelationshipId,
  focusedRelationshipIds,
  onSelect,
}: {
  relationships: Relationship[];
  selectedRelationshipId: string | null;
  focusedRelationshipIds: string[];
  onSelect: (id: string | null) => void;
}) {
  const timeline = useMemo(() => {
    try {
      return buildTimeline(relationships);
    } catch {
      return null;
    }
  }, [relationships]);
  const cited = useMemo(
    () => new Set(focusedRelationshipIds),
    [focusedRelationshipIds],
  );
  if (!timeline) return null;

  const laneCount = Math.max(
    1,
    ...timeline.marks.map((mark) => mark.lane + 1),
  );

  return (
    <div className="graph-timeline">
      <div className="graph-timeline-head">
        <div className="label">Timeline</div>
        <div className="font-mono text-[10px] text-dim">
          {timeline.startLabel} – {timeline.endLabel}
        </div>
      </div>
      <div
        className="graph-timeline-axis"
        style={{ height: 28 + laneCount * 22 }}
      >
        <div className="graph-timeline-line" />
        {timeline.ticks.map((tick) => (
          <div
            key={tick.label}
            className="graph-timeline-tick"
            style={{ left: `${tick.position * 100}%` }}
          >
            <span>{tick.label}</span>
          </div>
        ))}
        {timeline.marks.map((mark) => {
          const selected = selectedRelationshipId === mark.relationshipId;
          const focused = cited.has(mark.relationshipId);
          const isRange = mark.width > 0.012;
          return (
            <button
              key={mark.relationshipId}
              type="button"
              className={`graph-timeline-mark ${isRange ? "is-range" : "is-point"} ${
                mark.estimated ? "is-estimated" : ""
              } ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
              style={{
                left: `${mark.left * 100}%`,
                width: isRange ? `${Math.max(mark.width * 100, 1.4)}%` : undefined,
                top: 16 + mark.lane * 22,
              }}
              title={`${mark.type} ${mark.label}`}
              onClick={() => onSelect(mark.relationshipId)}
            >
              <span className="graph-timeline-mark-label">
                {mark.type} {mark.label}
              </span>
            </button>
          );
        })}
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
  chromeOpen?: boolean;
  onToggleChrome?: () => void;
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
