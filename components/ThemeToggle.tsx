"use client";

import { applyTheme, readDocumentTheme, type Theme } from "@/lib/theme";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(readDocumentTheme());
  }, []);

  const nextTheme: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(nextTheme);
        setTheme(nextTheme);
      }}
      className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:border-line-strong hover:text-ink"
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      suppressHydrationWarning
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
