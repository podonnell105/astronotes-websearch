import type { EpisodeTime, Relationship } from "./types";

export const EPISODE_REL_TYPES = new Set([
  "founded",
  "cofounded",
  "created",
  "acquired",
  "acquired_by",
  "lived_in",
  "born_in",
  "died_in",
  "educated_at",
  "partner_at",
  "chairs",
  "chairman",
  "joined",
  "relocated_to",
]);

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

export function parsePartialDate(value: unknown): string | undefined {
  if (value == null) return undefined;
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? String(Math.trunc(value))
      : String(value).trim();
  if (!raw) return undefined;

  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
  if (iso) return fromParts(iso[1].slice(0, 4), iso[1].slice(5, 7), iso[1].slice(8, 10));

  const ymd = raw.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (ymd) return fromParts(ymd[1], ymd[2], ymd[3]);

  const dmy = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (dmy) return fromParts(dmy[3], dmy[2], dmy[1]);

  const dmyDash = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmyDash) return fromParts(dmyDash[3], dmyDash[2], dmyDash[1]);

  return undefined;
}

function fromParts(yearRaw: string, monthRaw?: string, dayRaw?: string): string | undefined {
  const year = Number(yearRaw);
  if (!Number.isInteger(year) || year < 1000 || year > 2100) return undefined;
  if (!monthRaw) return String(year);
  const month = Number(monthRaw);
  if (!Number.isInteger(month) || month < 1 || month > 12) return undefined;
  const monthPart = String(month).padStart(2, "0");
  if (!dayRaw) return `${year}-${monthPart}`;
  const day = Number(dayRaw);
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  return `${year}-${monthPart}-${String(day).padStart(2, "0")}`;
}

export function parseEpisodeTime(raw: unknown): EpisodeTime | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const start = parsePartialDate(rec.start);
  if (!start) return undefined;
  const end = parsePartialDate(rec.end);
  const time: EpisodeTime = { start };
  if (end && end > start) time.end = end;
  if (rec.estimated === true) time.estimated = true;
  return time;
}

export function formatEpisodeTime(time?: EpisodeTime): string {
  const parsed = parseEpisodeTime(time);
  if (!parsed) return "";
  const start = formatPartialDate(parsed.start);
  if (!start) return "";
  const end = parsed.end ? formatPartialDate(parsed.end) : "";
  const range = end ? `${start}–${end}` : start;
  return parsed.estimated ? `c. ${range}` : range;
}

export function episodeStartMs(value: string): number {
  return episodeBoundMs(value, "start");
}

export function episodeEndMs(value: string): number {
  return episodeBoundMs(value, "end");
}

export type TimelineMark = {
  relationshipId: string;
  type: string;
  time: EpisodeTime;
  label: string;
  startMs: number;
  endMs: number;
  left: number;
  width: number;
  estimated: boolean;
  lane: number;
};

export type TimelineTick = {
  label: string;
  position: number;
};

export type TimelineView = {
  marks: TimelineMark[];
  startLabel: string;
  endLabel: string;
  ticks: TimelineTick[];
};

export function buildTimeline(relationships: Relationship[]): TimelineView | null {
  try {
    const prepared: Array<{
      rel: Relationship;
      time: EpisodeTime;
      startMs: number;
      endMs: number;
    }> = [];
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = Number.NEGATIVE_INFINITY;
    for (const rel of relationships) {
      const time = parseEpisodeTime(rel.time);
      if (!time) continue;
      const startMs = episodeStartMs(time.start);
      const endMs = time.end ? episodeEndMs(time.end) : startMs;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      minMs = Math.min(minMs, startMs);
      maxMs = Math.max(maxMs, endMs);
      prepared.push({ rel, time, startMs, endMs });
    }
    if (prepared.length === 0) return null;
    if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return null;
  const pad = Math.max(maxMs - minMs, YEAR_MS) * 0.08;
  const axisStart = minMs - pad;
  const axisEnd = maxMs + pad;
  const span = axisEnd - axisStart || YEAR_MS;

  const marks = assignLanes(
    prepared.map(({ rel, time, startMs, endMs }) => {
      const left = (startMs - axisStart) / span;
      const width = (endMs - startMs) / span;
      return {
        relationshipId: rel.id,
        type: rel.type,
        time,
        label: formatEpisodeTime(time),
        startMs,
        endMs,
        left,
        width,
        estimated: Boolean(time.estimated),
        lane: 0,
      };
    }),
  );

  return {
    marks,
    startLabel: formatPartialDate(earliestLabel(prepared.map((item) => item.time.start))),
    endLabel: formatPartialDate(latestLabel(prepared.map((item) => item.time.end ?? item.time.start))),
    ticks: yearTicks(axisStart, axisEnd),
  };
  } catch {
    return null;
  }
}

function formatPartialDate(value: string | undefined): string {
  const parsed = parsePartialDate(value);
  if (!parsed) return "";
  const [year, month, day] = parsed.split("-");
  if (day) return `${year}-${month}-${day}`;
  if (month) return `${year}-${month}`;
  return year;
}

function episodeBoundMs(value: string, bound: "start" | "end"): number {
  const parsed = parsePartialDate(value);
  if (!parsed) return Number.NaN;
  const [year, month, day] = parsed.split("-").map(Number);
  if (!Number.isInteger(year)) return Number.NaN;
  if (bound === "end") {
    if (!month) return Date.UTC(year, 11, 31);
    if (!day) return Date.UTC(year, month, 0);
    return Date.UTC(year, month - 1, day);
  }
  return Date.UTC(year, month ? month - 1 : 0, day || 1);
}

function assignLanes(marks: TimelineMark[]): TimelineMark[] {
  const lanes: number[] = [];
  return [...marks]
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .map((mark) => {
      const start = mark.left;
      const end = mark.left + Math.max(mark.width, 0.045);
      let lane = lanes.findIndex((occupied) => occupied + 0.01 <= start);
      if (lane < 0) {
        lane = Math.min(lanes.length, 2);
        if (lanes.length < 3) lanes.push(end);
        else lanes[lane] = end;
      } else {
        lanes[lane] = end;
      }
      return { ...mark, lane };
    });
}

function yearTicks(axisStart: number, axisEnd: number): TimelineTick[] {
  const startYear = new Date(axisStart).getUTCFullYear();
  const endYear = new Date(axisEnd).getUTCFullYear();
  const span = Math.max(1, endYear - startYear);
  const step = span <= 6 ? 1 : span <= 24 ? 5 : span <= 80 ? 10 : 20;
  const first = Math.floor(startYear / step) * step;
  const ticks: TimelineTick[] = [];
  for (let year = first; year <= endYear + step; year += step) {
    const position = (Date.UTC(year, 0, 1) - axisStart) / (axisEnd - axisStart || 1);
    if (position < -0.02 || position > 1.02) continue;
    ticks.push({
      label: String(year),
      position: Math.min(1, Math.max(0, position)),
    });
  }
  return ticks;
}

function earliestLabel(values: string[]): string {
  return [...values].sort()[0] ?? "";
}

function latestLabel(values: string[]): string {
  return [...values].sort()[values.length - 1] ?? "";
}
