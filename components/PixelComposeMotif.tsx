/**
 * Pixel-grid loader for composing state — crisp tiles, travelling colour wave.
 * Colours cloned from astronotes.ai: accent, accent-secondary, accent-tertiary.
 */
import type { CSSProperties } from "react";

const ROWS = 4;
const COLS = 4;

export function PixelComposeMotif({ className = "" }: { className?: string }) {
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells.push({ key: `${r}-${c}`, wave: r + c });
    }
  }

  return (
    <div
      className={`pixel-compose-motif ${className}`.trim()}
      aria-hidden
      role="presentation"
    >
      {cells.map(({ key, wave }) => (
        <span
          key={key}
          className="pixel-compose-motif__cell"
          style={{ "--wave": wave } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function formatElapsed(ms: number): string {
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}
