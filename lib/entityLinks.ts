export type LinkedEntity = {
  id: string;
  name: string;
};

export type LinkedTextSegment =
  | { type: "text"; text: string }
  | { type: "entity"; text: string; entityId: string };

const MARKER = /\[\[([^\|\]]+)\|([^\]]+)\]\]/g;

export function linkifyEntityText(
  text: string,
  entities: LinkedEntity[],
  preferredIds: string[] = [],
): LinkedTextSegment[] {
  const known = new Map(entities.map((entity) => [entity.id, entity]));
  const preferred = new Set(preferredIds.filter((id) => known.has(id)));
  const marked = splitMarkers(text, known);
  return marked.flatMap((segment) =>
    segment.type === "entity"
      ? [segment]
      : splitNames(segment.text, entities, preferred),
  );
}

function splitMarkers(
  text: string,
  known: Map<string, LinkedEntity>,
): LinkedTextSegment[] {
  const segments: LinkedTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ type: "text", text: text.slice(last, index) });
    }
    const entityId = match[1]?.trim() ?? "";
    const label = match[2]?.trim() || known.get(entityId)?.name || entityId;
    if (known.has(entityId)) {
      segments.push({ type: "entity", text: label, entityId });
    } else {
      segments.push({ type: "text", text: label });
    }
    last = index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ type: "text", text: text.slice(last) });
  }
  return segments.length > 0 ? segments : [{ type: "text", text }];
}

function splitNames(
  text: string,
  entities: LinkedEntity[],
  preferred: Set<string>,
): LinkedTextSegment[] {
  if (!text) return [];
  const usable = [...entities]
    .filter((entity) => entity.name.trim().length >= 3)
    .sort((a, b) => b.name.length - a.name.length);
  if (usable.length === 0) return [{ type: "text", text }];

  const byName = new Map<string, LinkedEntity>();
  for (const entity of usable) {
    const key = entity.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || (preferred.has(entity.id) && !preferred.has(existing.id))) {
      byName.set(key, entity);
    }
  }

  const pattern = [...byName.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  if (!pattern) return [{ type: "text", text }];

  const re = new RegExp(`(^|[^A-Za-z0-9])(${pattern})(?![A-Za-z0-9])`, "gi");
  const segments: LinkedTextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const index = match.index ?? 0;
    const nameStart = index + prefix.length;
    if (nameStart > last) {
      segments.push({ type: "text", text: text.slice(last, nameStart) });
    }
    const entity = byName.get(name.toLowerCase());
    if (entity) {
      segments.push({
        type: "entity",
        text: text.slice(nameStart, nameStart + name.length),
        entityId: entity.id,
      });
    } else {
      segments.push({ type: "text", text: name });
    }
    last = nameStart + name.length;
  }
  if (last < text.length) {
    segments.push({ type: "text", text: text.slice(last) });
  }
  return segments.length > 0 ? segments : [{ type: "text", text }];
}

export function annotateEntityMentions(
  text: string,
  entities: LinkedEntity[],
  preferredIds: string[] = [],
): string {
  return linkifyEntityText(text, entities, preferredIds)
    .map((segment) =>
      segment.type === "entity"
        ? `[[${segment.entityId}|${segment.text}]]`
        : segment.text,
    )
    .join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
